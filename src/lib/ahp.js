/** Analytic Hierarchy Process: principal-eigenvector weights and Saaty consistency ratio. */
export const RI = { 1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45 };
export const SAATY = [1 / 9, 1 / 7, 1 / 5, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function saatyLabel(v) {
  if (v >= 1) return String(Math.round(v));
  return `1/${Math.round(1 / v)}`;
}

export function ahp(A) {
  const n = A.length;
  let w = new Array(n).fill(1 / n);
  let lambda = n;
  for (let it = 0; it < 200; it++) {
    const Aw = A.map((row) => row.reduce((s, a, j) => s + a * w[j], 0));
    const sum = Aw.reduce((s, x) => s + x, 0);
    const next = Aw.map((x) => x / sum);
    lambda = Aw.reduce((s, x, i) => s + x / w[i], 0) / n;
    const diff = next.reduce((s, x, i) => s + Math.abs(x - w[i]), 0);
    w = next;
    if (diff < 1e-12) break;
  }
  const ci = (lambda - n) / (n - 1);
  const cr = RI[n] ? ci / RI[n] : 0;
  return { weights: w, lambda, ci, cr };
}

export function matrixFromUpper(n, upper) {
  const A = Array.from({ length: n }, () => new Array(n).fill(1));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { A[i][j] = upper[i][j]; A[j][i] = 1 / upper[i][j]; }
  return A;
}
