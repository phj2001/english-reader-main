# Tesseract OCR 安装与修复指南

## 问题说明
错误 `Command '['tesseract', '--version']' returned non-zero exit status 3221225781` 表示：
- Tesseract 未安装或配置不正确
- 缺少必要的 Visual C++ 运行库
- 环境变量未正确配置

---

## 快速修复（推荐）

### 方式一：自动安装（首次使用）

1. **以管理员身份运行 PowerShell**
   - 右键点击开始菜单 → Windows PowerShell (管理员)
   - 或者在 PowerShell 中输入后回车：
     ```powershell
     Start-Process powershell -Verb runAs
     ```

2. **运行安装脚本**
   ```powershell
   cd C:\Users\Administrator\Desktop\enlish-reader-main
   .\install_tesseract.ps1
   ```

3. **重启终端并验证**
   ```powershell
   tesseract --version
   ```

### 方式二：修复配置（已安装但报错）

1. **运行修复脚本**
   ```powershell
   cd C:\Users\Administrator\Desktop\enlish-reader-main
   .\fix_tesseract.ps1
   ```

2. **重启终端并验证**

---

## 手动安装（如脚本失败）

### 1. 下载 Tesseract
访问：https://github.com/UB-Mannheim/tesseract/wiki

下载最新版本的 **64-bit setup** (推荐 `tesseract-ocr-w64-setup-5.3.3.20231005.exe`)

### 2. 安装步骤
1. 运行安装程序
2. 选择安装路径（建议默认：`C:\Program Files\Tesseract-OCR`）
3. 勾选 "Additional language data" → 选择 "English" 和 "Chinese_Simplified"
4. 完成安装

### 3. 配置环境变量
1. 右键 "此电脑" → 属性 → 高级系统设置
2. 环境变量 → 用户变量 → Path → 编辑
3. 新建 → 输入：`C:\Program Files\Tesseract-OCR`
4. 确定并重启终端

### 4. 安装 Visual C++ 运行库
如果仍然报错，下载安装：
- Microsoft Visual C++ 2015-2022 Redistributable (x64)
- https://aka.ms/vs/17/release/vc_redist.x64.exe

---

## 验证安装

在 PowerShell 或 CMD 中运行：
```powershell
tesseract --version
```

应该显示类似：
```
tesseract 5.3.3
 leptonica-1.83.1
  libgif 5.2.1 : libjpeg 8.0 (libjpeg-turbo 1.5.3) : libpng 1.6.34 : libtiff 4.0.9 : zlib 1.2.11 : libwebp 1.0.2
 Found AVX2
 Found AVX
 Found SSE
```

---

## 配置 Python 项目

安装完成后，编辑 `english-reader-server/app/.env` 文件（如果没有则从 `.env.example` 复制），添加：

```bash
# Tesseract 可执行文件路径
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

或者修改 `english-reader-server/app/ocr_service.py`，在 `import pytesseract` 后添加：

```python
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
```

---

## 启动项目

配置完成后，启动后端服务：

```powershell
cd english-reader-server\app
python main.py
```

---

## 常见问题

### Q: 错误代码 3221225781 仍然存在
**A:** 这是 DLL 缺失问题，请安装 Visual C++ 运行库

### Q: 提示 "tesseract 不是内部或外部命令"
**A:** 环境变量未生效，请重启终端或手动添加到 PATH

### Q: PowerShell 无法运行脚本
**A:** 执行以下命令解除限制：
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q: 需要其他语言支持
**A:** 重新运行 Tesseract 安装程序，选择 "Additional language data"
