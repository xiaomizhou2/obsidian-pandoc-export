# Obsidian Pandoc Export Plugin

这个插件允许你使用[Pandoc](https://pandoc.org/)将Obsidian的Markdown文件导出为多种格式，包括PDF、DOCX、HTML、EPUB和ODT。

## 功能特点

- 通过Pandoc导出Markdown文件为多种格式
- 支持PDF、DOCX、HTML、EPUB和ODT格式
- 可自定义Pandoc路径和导出目录
- 可添加自定义Pandoc命令行参数
- 通过命令面板、文件菜单或功能区图标轻松访问

## 安装前提条件

1. **安装Pandoc**: 该插件依赖于Pandoc，必须在你的系统上安装Pandoc才能使用。
   - 从[Pandoc官网](https://pandoc.org/installing.html)下载并安装
   - 确保Pandoc已添加到你的系统PATH中

## 安装插件

### 从Obsidian社区插件商店安装

1. 打开Obsidian
2. 转到设置 > 第三方插件
3. 禁用安全模式
4. 点击"浏览"，搜索"Pandoc Export"
5. 安装插件，然后启用它

### 手动安装

1. 从GitHub Releases页面下载最新版本
2. 解压缩下载的文件
3. 将解压后的文件夹放入你的Obsidian vault的`.obsidian/plugins/`目录中
4. 重启Obsidian并在设置 > 第三方插件中启用该插件

## 使用方法

### 导出当前文件

有三种方式可以打开导出对话框：

1. 点击左侧功能区的"导出"图标
2. 右键点击文件，选择"使用Pandoc导出"
3. 使用命令面板（Ctrl/Cmd+P），搜索"Export current file with Pandoc"

在导出对话框中：
1. 选择所需的输出格式
2. 点击"导出"按钮
3. 文件将被导出到配置的导出目录中

### 配置插件

转到设置 > 第三方插件 > Pandoc Export > 设置图标，可以配置以下选项：

- **Pandoc路径**: Pandoc可执行文件的路径（默认为"pandoc"，如果已添加到PATH中）
- **默认导出目录**: 导出文件的默认目录（留空使用vault根目录）
- **默认格式**: 默认导出格式（PDF、DOCX、HTML、EPUB或ODT）
- **自定义Pandoc参数**: 传递给Pandoc的额外命令行参数

## 故障排除

如果遇到问题：

1. 确保Pandoc正确安装并可从命令行访问
2. 检查插件设置中的Pandoc路径是否正确
3. 如果导出失败，请查看控制台日志以获取详细错误信息（Ctrl+Shift+I）

## 常见问题

### 为什么导出PDF时出现错误？

PDF导出需要LaTeX环境。确保你已安装完整的LaTeX发行版（如[MiKTeX](https://miktex.org/)、[TeX Live](https://www.tug.org/texlive/)）或Pandoc的PDF引擎（如[wkhtmltopdf](https://wkhtmltopdf.org/)）。

### 如何自定义导出格式？

你可以在插件设置的"自定义Pandoc参数"字段中添加Pandoc参数。例如：

- 使用特定的LaTeX模板：`--template=my-template.latex`
- 添加目录：`--toc`
- 更改PDF引擎：`--pdf-engine=xelatex`

## 贡献

欢迎贡献代码、报告问题或提出改进建议。

## 许可证

本项目采用MIT许可证。

---

由 [你的名字] 开发
