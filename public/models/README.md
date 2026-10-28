# PaddleOCR ONNX model assets

Run from the project root:

```powershell
pnpm run models:setup
pnpm run build
```

This downloads the official PaddlePaddle ONNX weights and matching YAML configs **during setup**, then packages them into `PP-OCRv5_mobile_det.tar` and `en_PP-OCRv5_mobile_rec.tar` here.

Do **not** rename `PP-OCRv5_mobile_det_infer.tar` or `en_PP-OCRv5_mobile_rec_infer.tar`: those contain Paddle-format inference weights, not the ONNX weights that this extension requires.
