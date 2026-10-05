# remotezip.py — read members of a remote ZIP over HTTP Range requests, so a
# handful of files can be pulled out of a multi-GB archive (VocalSet 2.1 GB,
# DCASE 2020 T2 1-1.9 GB per machine, DEMAND ~100 MB per environment) without
# downloading the whole thing. Pure stdlib + requests.
#
#   from remotezip import RemoteZip
#   rz = RemoteZip(url)            # reads the central directory (2 ranges)
#   names = rz.namelist()
#   data = rz.read(name)           # bytes of one member (1 range)
import io, zipfile, requests, time

class _RangeFile(io.RawIOBase):
    def __init__(self, url, size, session, chunk=1 << 20):
        self.url, self.size, self.s, self.pos = url, size, session, 0
        self.chunk = chunk; self._cache = {}
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos
    def _get(self, a, b):
        for attempt in range(6):
            try:
                r = self.s.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
                if r.status_code == 206: return r.content
                if r.status_code == 429: time.sleep(30 * (attempt + 1)); continue
                raise IOError(f"range {a}-{b}: HTTP {r.status_code}")
            except requests.RequestException:
                time.sleep(10 * (attempt + 1))
        raise IOError(f"range {a}-{b}: retries exhausted")
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if n == 0: return b""
        # block cache (zipfile reads headers in small pieces)
        out = bytearray(); p = self.pos; end = p + n
        while p < end:
            blk = p // self.chunk
            if blk not in self._cache:
                if len(self._cache) > 64: self._cache.clear()
                a = blk * self.chunk; b = min(self.size, a + self.chunk) - 1
                self._cache[blk] = self._get(a, b)
            data = self._cache[blk]; o = p - blk * self.chunk
            take = min(end - p, len(data) - o)
            out += data[o:o + take]; p += take
        self.pos = end
        return bytes(out)
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

class RemoteZip:
    def __init__(self, url, chunk=1 << 20):
        self.s = requests.Session()
        for k in range(8):
            try:
                h = self.s.head(url, allow_redirects=True, timeout=60)
                if h.status_code == 200: break
            except requests.RequestException:
                pass
            time.sleep(10 * (k + 1))
        else:
            raise IOError(f"HEAD {url} failed")
        self.url = h.url
        size = int(h.headers.get("content-length", 0))
        if not size:
            r = self.s.get(url, headers={"Range": "bytes=0-0"}, timeout=60)
            size = int(r.headers["content-range"].split("/")[1])
        self.f = _RangeFile(self.url, size, self.s, chunk)
        self.z = zipfile.ZipFile(io.BufferedReader(self.f, buffer_size=chunk))
    def namelist(self): return self.z.namelist()
    def infolist(self): return self.z.infolist()
    def read(self, name):
        info = self.z.getinfo(name)
        # big members: widen the block size to the member so it is one range
        self.f.chunk = max(1 << 20, info.compress_size + 4096); self.f._cache.clear()
        try: return self.z.read(name)
        finally: self.f.chunk = 1 << 20; self.f._cache.clear()
