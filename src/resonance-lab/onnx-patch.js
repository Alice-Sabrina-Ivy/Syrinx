// onnx-patch.js — expose an intermediate tensor of an ONNX model through
// its existing output, by editing the protobuf bytes in place (no onnx
// runtime or protobuf library needed).
//
// Used by the resonance lab to run the DEPLOYED perceived-voice model
// (Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2, fetched from the
// Hub exactly as the production gender worker does) with its 192-d fc6
// embedding (`relu_33`) available, so the pnml resonance head can be
// applied in JS from the same single inference that also yields the
// original fc7 logits. The transformers.js model call only returns the
// output named "logits", so the patch renames the original logits tensor
// and re-creates "logits" as Concat([fc7 logits, relu_33], axis 1):
//   logits[0..1]   = original [male, female] logits (unchanged)
//   logits[2..193] = relu_33 embedding
// The graph output's declared [1, 2] shape is replaced by an unshaped
// float tensor. Everything else (weights, quantisation) is byte-identical.

// ---- minimal protobuf wire-format helpers ----
function readVarint(buf, pos) {
  let result = 0, mul = 1, b;
  do {
    b = buf[pos++];
    result += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return [result, pos];
}
function encodeVarint(n) {
  const out = [];
  while (n >= 0x80) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}
/** Parse a message into [{field, wire, start, end, dataStart}] (top level only). */
function fields(buf, start = 0, end = buf.length) {
  const out = [];
  let pos = start;
  while (pos < end) {
    const s = pos;
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), wire = key & 7;
    let dataStart = pos;
    if (wire === 0) { [, pos] = readVarint(buf, pos); }
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) { let len; [len, pos] = readVarint(buf, pos); dataStart = pos; pos += len; }
    else throw new Error(`unsupported protobuf wire type ${wire}`);
    out.push({ field, wire, start: s, end: pos, dataStart });
  }
  return out;
}
const te = new TextEncoder();
const td = new TextDecoder();
function lenField(field, payload) {
  const head = Uint8Array.from([...encodeVarint(field * 8 + 2), ...encodeVarint(payload.length)]);
  const out = new Uint8Array(head.length + payload.length);
  out.set(head, 0);
  out.set(payload, head.length);
  return out;
}
function strField(field, s) { return lenField(field, te.encode(s)); }
function varintField(field, v) { return Uint8Array.from([...encodeVarint(field * 8), ...encodeVarint(v)]); }
function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * modelBytes: Uint8Array of an ONNX ModelProto. Returns patched bytes where
 * output `outputName` = Concat([original outputName, extraTensor], axis).
 */
export function concatIntoOutput(modelBytes, { outputName = "logits", extraTensor = "relu_33", axis = 1 } = {}) {
  const buf = modelBytes;
  const top = fields(buf);
  const g = top.find((f) => f.field === 7 && f.wire === 2); // ModelProto.graph
  if (!g) throw new Error("ONNX model has no graph");
  const renamed = `${outputName}__orig`;
  const gf = fields(buf, g.dataStart, g.end);
  const parts = [];
  let foundProducer = false, foundOutput = false, foundExtra = false;
  for (const f of gf) {
    const raw = buf.subarray(f.start, f.end);
    if (f.field === 1 && f.wire === 2) { // NodeProto
      const nf = fields(buf, f.dataStart, f.end);
      let hit = false;
      const np = nf.map((x) => {
        const xb = buf.subarray(x.start, x.end);
        if (x.field === 2 && x.wire === 2) { // NodeProto.output
          const name = td.decode(buf.subarray(x.dataStart, x.end));
          if (name === extraTensor) foundExtra = true;
          if (name === outputName) { hit = true; return strField(2, renamed); }
        }
        return xb;
      });
      if (hit) { foundProducer = true; parts.push(lenField(1, concatBytes(np))); continue; }
      parts.push(raw);
    } else if (f.field === 12 && f.wire === 2) { // GraphProto.output (ValueInfoProto)
      const vf = fields(buf, f.dataStart, f.end);
      const nameF = vf.find((x) => x.field === 1);
      const name = nameF ? td.decode(buf.subarray(nameF.dataStart, nameF.end)) : "";
      if (name === outputName) {
        foundOutput = true;
        // ValueInfoProto{name, type: TypeProto{tensor_type{elem_type: FLOAT(1),
        //   shape: [1, "<symbolic>"]}}} — the width is now 2 + embedding size
        const shape = concatBytes([lenField(1, varintField(1, 1)), lenField(1, strField(2, `${outputName}_width`))]);
        const tensorType = concatBytes([varintField(1, 1), lenField(2, shape)]);
        const typeProto = lenField(1, tensorType);
        parts.push(lenField(12, concatBytes([strField(1, outputName), lenField(2, typeProto)])));
        continue;
      }
      parts.push(raw);
    } else {
      parts.push(raw);
    }
  }
  if (!foundProducer || !foundOutput || !foundExtra) {
    throw new Error(`patch failed (producer ${foundProducer}, output ${foundOutput}, ${extraTensor} ${foundExtra})`);
  }
  // Concat node, appended last (graph nodes stay topologically sorted)
  const attr = concatBytes([strField(1, "axis"), varintField(3, axis), varintField(20, 2)]); // AttributeProto INT
  const node = concatBytes([
    strField(1, renamed), strField(1, extraTensor), strField(2, outputName),
    strField(3, "resonance_lab_concat"), strField(4, "Concat"), lenField(5, attr),
  ]);
  parts.push(lenField(1, node));
  const graph = concatBytes(parts);
  const out = [];
  for (const f of top) {
    if (f === g) out.push(lenField(7, graph));
    else out.push(buf.subarray(f.start, f.end));
  }
  return concatBytes(out);
}
