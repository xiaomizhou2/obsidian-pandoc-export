# Obsidian Pandoc Export 插件使用指南

## 安装步骤

1. 确保你的系统上已安装 Pandoc
   - 在命令行中输入 `pandoc --version` 检查是否已安装
   - 如果未安装，请访问 [Pandoc官网](https://pandoc.org/installing.html) 下载安装

2. 在Obsidian中安装插件
   - 将插件文件夹放入你的Obsidian仓库的 `.obsidian/plugins/` 目录
   - 插件文件夹应包含 `main.js`, `manifest.json` 和 `styles.css` 文件
   - 重启Obsidian并在设置 > 第三方插件中启用

## 配置插件

1. 访问设置 > 第三方插件 > Pandoc Export > 设置图标
2. 设置以下选项：
   - **Pandoc路径**: 如果Pandoc在你的系统PATH中，保持默认值 "pandoc"
   - **默认导出目录**: 设置导出文件的保存位置（留空使用仓库根目录）
   - **默认格式**: 选择默认导出格式（PDF、DOCX等）
   - **自定义Pandoc参数**: 添加任何需要的Pandoc命令行参数

## 使用方法

### 导出当前文件

有三种方式可以导出当前打开的Markdown文件：

1. **使用功能区图标**
   - 点击左侧功能区中的下载图标
   - 选择导出格式
   - 点击"导出"

2. **使用文件上下文菜单**
   - 在文件浏览器中右键点击Markdown文件
   - 选择"使用Pandoc导出"
   - 选择导出格式
   - 点击"导出"

3. **使用命令面板**
   - 按下 Ctrl/Cmd+P 打开命令面板
   - 搜索"Export current file with Pandoc"
   - 选择导出格式
   - 点击"导出"

### 自定义导出

对于更高级的导出需求，可以在设置中配置自定义Pandoc参数，例如：

- 使用特定模板：`--template=my-template.latex`
- 添加目录：`--toc`
- 更改PDF引擎：`--pdf-engine=xelatex`

## 故障排除

如果遇到导出问题：

1. 检查Pandoc是否正常工作（在命令行尝试简单的Pandoc命令）
2. 确认导出路径有写入权限
3. 查看Obsidian控制台日志以获取详细错误信息（Ctrl+Shift+I）

## 示例用例

1. **导出为印刷质量的PDF**
   - 配置自定义参数：`--pdf-engine=xelatex --template=eisvogel`
   - 适合创建正式文档或报告

2. **创建带有目录的DOCX**
   - 配置自定义参数：`--toc --reference-doc=my-reference.docx`
   - 适合与使用Word的同事共享

3. **生成自包含HTML文件**
   - 配置自定义参数：`--self-contained --css=style.css`
   - 适合分享可在任何浏览器打开的单文件版本 