# Testing v2.7

```powershell
pnpm test
python tests/browser-v27-smoke.py
pnpm run build
```

Node tests (no models needed) verify exact text format, website persistence,
sender authorization, stale revision rejection and packaging. Browser smoke test
uses a blob URL image and mocks service-worker messages; it verifies picking,
monitoring, clearing stale text, filling the input, green highlighting and
saved-site reactivation. It does not test PaddleOCR neural inference.

Run the production build with both ONNX model archives installed in
`public/models/` and your existing node modules. The built extension must be
loaded from `dist/`.
