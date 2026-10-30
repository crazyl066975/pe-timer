# 体育助手（手机网页版）

「体育教师工作台」的手机助手。iPhone 用 Safari 打开后点「分享 → 添加到主屏幕」，就能像 App 一样使用；安卓另有安装包。

- 打开就能看今天的课和教案，上课时计时、记成绩、记课堂练习、拍视频，直接传到老师自己的电脑。
- 这里只放程序，**不存任何学生数据**。名单和成绩只在老师的手机和电脑之间加密传输（AES-GCM），密钥只在电脑上的二维码里。
- 二维码识别使用开源库 jsQR（Apache License 2.0，见 `jsQR-LICENSE.txt`）。
- AI 计数使用开源的 MediaPipe Tasks Vision 和 Pose Landmarker Lite 模型（Apache License 2.0，见 `vendor/mediapipe/NOTICE.txt`）。动作识别全部在手机上完成，画面不上传。
