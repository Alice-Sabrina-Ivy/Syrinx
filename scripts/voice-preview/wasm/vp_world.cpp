// vp_world.cpp — a small flat C API over WORLD (M. Morise, modified BSD; the
// library source is fetched at a pinned commit by ../build.mjs and is NOT part
// of this repository) for the voice-preview spike. Own code, MIT, like the
// rest of Syrinx.
//
// Everything is float64, as in pyworld. Matrices (spectral envelope,
// aperiodicity) are flat row-major buffers of n_frames x (fft_size / 2 + 1)
// doubles in WebAssembly memory; the caller allocates them with malloc/free
// (exported) so that analysis results can stay in WebAssembly memory between
// renders. Defaults follow pyworld 0.3.5 — the caller passes them explicitly
// (see ../lib/world-engine.mjs), so nothing here hides a parameter.
//
// vp_warp is the formant envelope warp of the scratch prototype
// (world_render.py World._warp), written out in C:
//   f_k = k * fs / fft_size   (k = 0 .. fft_size / 2; numpy.linspace(0, fs/2, nb)
//                              gives exactly these values at 16 / 22.05 / 24 kHz)
//   ln S'(f_k) = interp(f_k / a; f, ln max(S, 1e-16)),  S' = exp(.)
//   A'(f_k)    = clip(interp(f_k / a; f, A), 0, 1)
// with interp = numpy.interp (linear, clamped to the end values, the same
// bracket search and the same slope formula). a == 1 is a plain copy.

#include <cmath>
#include <cstdlib>
#include <cstring>

#include "world/cheaptrick.h"
#include "world/d4c.h"
#include "world/dio.h"
#include "world/harvest.h"
#include "world/stonemask.h"
#include "world/synthesis.h"

#define VP_EXPORT extern "C" __attribute__((used, visibility("default")))

namespace {

// Row-pointer view of a flat row-major matrix (WORLD takes double**).
double **Rows(double *flat, int n_rows, int n_cols) {
  double **rows = static_cast<double **>(malloc(sizeof(double *) * (n_rows > 0 ? n_rows : 1)));
  for (int i = 0; i < n_rows; ++i) rows[i] = flat + static_cast<size_t>(i) * n_cols;
  return rows;
}

// numpy.interp(x, xp, fp) for one point on an increasing grid xp, with the
// default left/right values fp[0] / fp[n-1]. Mirrors numpy's arr_interp:
// j = the largest index with xp[j] <= x; exact grid hits return fp[j].
inline double Interp(double x, const double *xp, const double *fp, int n, double inv_step) {
  if (x > xp[n - 1]) return fp[n - 1];
  if (x < xp[0]) return fp[0];
  int j = static_cast<int>(x * inv_step);
  if (j > n - 1) j = n - 1;
  if (j < 0) j = 0;
  while (j + 1 < n && xp[j + 1] <= x) ++j;
  while (j > 0 && xp[j] > x) --j;
  if (j == n - 1) return fp[j];
  if (xp[j] == x) return fp[j];
  const double slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
  return slope * (x - xp[j]) + fp[j];
}

}  // namespace

VP_EXPORT int vp_version() { return 1; }

VP_EXPORT int vp_dio_frames(int fs, int x_length, double frame_period) {
  return GetSamplesForDIO(fs, x_length, frame_period);
}

VP_EXPORT int vp_harvest_frames(int fs, int x_length, double frame_period) {
  return GetSamplesForHarvest(fs, x_length, frame_period);
}

VP_EXPORT void vp_dio(const double *x, int x_length, int fs, double frame_period,
                      double f0_floor, double f0_ceil, double channels_in_octave,
                      int speed, double allowed_range, double *temporal_positions,
                      double *f0) {
  DioOption option;
  InitializeDioOption(&option);
  option.channels_in_octave = channels_in_octave;
  option.f0_floor = f0_floor;
  option.f0_ceil = f0_ceil;
  option.frame_period = frame_period;
  option.speed = speed;
  option.allowed_range = allowed_range;
  Dio(x, x_length, fs, &option, temporal_positions, f0);
}

VP_EXPORT void vp_harvest(const double *x, int x_length, int fs, double frame_period,
                          double f0_floor, double f0_ceil, double *temporal_positions,
                          double *f0) {
  HarvestOption option;
  InitializeHarvestOption(&option);
  option.f0_floor = f0_floor;
  option.f0_ceil = f0_ceil;
  option.frame_period = frame_period;
  Harvest(x, x_length, fs, &option, temporal_positions, f0);
}

VP_EXPORT void vp_stonemask(const double *x, int x_length, int fs,
                            const double *temporal_positions, const double *f0,
                            int f0_length, double *refined_f0) {
  StoneMask(x, x_length, fs, temporal_positions, f0, f0_length, refined_f0);
}

// pyworld: InitializeCheapTrickOption(fs), then f0_floor, then the FFT size
// from WORLD's own rule (fft_size <= 0 here) or the caller's.
VP_EXPORT int vp_cheaptrick_fft_size(int fs, double f0_floor) {
  CheapTrickOption option;
  InitializeCheapTrickOption(fs, &option);
  option.f0_floor = f0_floor;
  return GetFFTSizeForCheapTrick(fs, &option);
}

VP_EXPORT void vp_cheaptrick(const double *x, int x_length, int fs,
                             const double *temporal_positions, const double *f0,
                             int f0_length, double q1, double f0_floor, int fft_size,
                             double *spectrogram) {
  CheapTrickOption option;
  InitializeCheapTrickOption(fs, &option);
  option.q1 = q1;
  option.f0_floor = f0_floor;
  option.fft_size = fft_size > 0 ? fft_size : GetFFTSizeForCheapTrick(fs, &option);
  double **rows = Rows(spectrogram, f0_length, option.fft_size / 2 + 1);
  CheapTrick(x, x_length, fs, temporal_positions, f0, f0_length, &option, rows);
  free(rows);
}

VP_EXPORT void vp_d4c(const double *x, int x_length, int fs,
                      const double *temporal_positions, const double *f0, int f0_length,
                      int fft_size, double threshold, double *aperiodicity) {
  D4COption option;
  InitializeD4COption(&option);
  option.threshold = threshold;
  double **rows = Rows(aperiodicity, f0_length, fft_size / 2 + 1);
  D4C(x, x_length, fs, temporal_positions, f0, f0_length, fft_size, &option, rows);
  free(rows);
}

// Formant envelope warp (see the header comment). sp_out / ap_out may not
// alias sp / ap.
VP_EXPORT void vp_warp(const double *sp, const double *ap, int f0_length, int fft_size,
                       int fs, double a, double *sp_out, double *ap_out) {
  const int nb = fft_size / 2 + 1;
  const size_t total = static_cast<size_t>(f0_length) * nb;
  if (a == 1.0) {
    memcpy(sp_out, sp, total * sizeof(double));
    memcpy(ap_out, ap, total * sizeof(double));
    return;
  }
  double *freqs = static_cast<double *>(malloc(sizeof(double) * nb * 3));
  double *src = freqs + nb;
  double *row = freqs + 2 * nb;
  const double step = (fs / 2.0) / (nb - 1);  // numpy.linspace(0, fs / 2, nb) step
  for (int k = 0; k < nb; ++k) freqs[k] = k * step;
  freqs[nb - 1] = fs / 2.0;
  for (int k = 0; k < nb; ++k) src[k] = freqs[k] / a;
  const double inv_step = 1.0 / step;
  for (int i = 0; i < f0_length; ++i) {
    const double *s = sp + static_cast<size_t>(i) * nb;
    const double *p = ap + static_cast<size_t>(i) * nb;
    double *so = sp_out + static_cast<size_t>(i) * nb;
    double *po = ap_out + static_cast<size_t>(i) * nb;
    for (int k = 0; k < nb; ++k) row[k] = log(s[k] > 1e-16 ? s[k] : 1e-16);
    for (int k = 0; k < nb; ++k) so[k] = exp(Interp(src[k], freqs, row, nb, inv_step));
    for (int k = 0; k < nb; ++k) {
      const double v = Interp(src[k], freqs, p, nb, inv_step);
      po[k] = v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
    }
  }
  free(freqs);
}

// pyworld.synthesize's output length: int(f0_length * frame_period * fs / 1000).
VP_EXPORT int vp_synthesis_length(int f0_length, double frame_period, int fs) {
  return static_cast<int>(f0_length * frame_period * fs / 1000);
}

VP_EXPORT void vp_synthesize(const double *f0, int f0_length, const double *spectrogram,
                             const double *aperiodicity, int fft_size, double frame_period,
                             int fs, int y_length, double *y) {
  const int nb = fft_size / 2 + 1;
  double **sp = Rows(const_cast<double *>(spectrogram), f0_length, nb);
  double **ap = Rows(const_cast<double *>(aperiodicity), f0_length, nb);
  Synthesis(f0, f0_length, sp, ap, fft_size, frame_period, fs, y_length, y);
  free(sp);
  free(ap);
}
