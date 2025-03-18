import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, Menu, MenuItem } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const execPromise = promisify(exec);

interface PandocExportSettings {
	pandocPath: string;
	defaultExportDirectory: string;
	defaultFormat: string;
	customArguments: string;
	pdfEngine: string;
}

const DEFAULT_SETTINGS: PandocExportSettings = {
	pandocPath: 'pandoc',
	defaultExportDirectory: '',
	defaultFormat: 'pdf',
	customArguments: '',
	pdfEngine: 'auto'
}

export default class PandocExportPlugin extends Plugin {
	settings: PandocExportSettings;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon for exporting the current file
		this.addRibbonIcon('download', 'Pandoc导出', (evt: MouseEvent) => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.extension === 'md') {
				new PandocExportModal(this.app, this, activeFile).open();
			} else {
				new Notice('没有打开的Markdown文件');
			}
		});

		// Add command to export the current file
		this.addCommand({
			id: 'export-current-file',
			name: '使用Pandoc导出当前文件',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === 'md') {
					if (!checking) {
						new PandocExportModal(this.app, this, activeFile).open();
					}
					return true;
				}
				return false;
			}
		});

		// Add context menu item for exporting files
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item
							.setTitle('使用Pandoc导出')
							.setIcon('download')
							.onClick(() => {
								new PandocExportModal(this.app, this, file).open();
							});
					});
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new PandocExportSettingTab(this.app, this));
	}

	onunload() {
		// Clean up when the plugin is disabled
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Get the vault directory path
	 */
	getVaultPath(): string {
		// @ts-ignore - adapter is not officially in the API but is commonly used
		const adapter = this.app.vault.adapter;
		if ('basePath' in adapter) {
			// @ts-ignore - basePath exists but is not in the type definitions
			return adapter.basePath;
		}
		return '';
	}

	/**
	 * Get the export directory path, creating it if it doesn't exist
	 */
	async getExportDirectory(): Promise<string> {
		const vaultPath = this.getVaultPath();
		let exportPath = this.settings.defaultExportDirectory;
		
		if (!exportPath) {
			return vaultPath;
		}

		// Handle both absolute and relative paths
		if (!path.isAbsolute(exportPath)) {
			exportPath = path.join(vaultPath, exportPath);
		}

		// Create directory if it doesn't exist
		try {
			await fs.promises.mkdir(exportPath, { recursive: true });
		} catch (error) {
			console.error('Failed to create export directory:', error);
			new Notice('创建导出目录失败。请查看控制台获取详细信息。');
			return vaultPath;
		}

		return exportPath;
	}

	/**
	 * Export a markdown file using Pandoc
	 */
	async exportFile(file: TFile, format: string, outputPath: string): Promise<void> {
		try {
			// Get the full content of the file
			const content = await this.app.vault.read(file);
			
			// Create a temporary file to store the content
			const tempFilePath = path.join(
				os.tmpdir(),
				`${file.basename}-temp.md`
			);
			
			await fs.promises.writeFile(tempFilePath, content);
			
			// 获取Pandoc路径
			let pandocPath = this.settings.pandocPath;
			let pandocFound = false;
			
			// 1. 首先直接检查用户设置的路径是否存在且可执行
			if (pandocPath && pandocPath !== 'pandoc') {
				try {
					if (path.isAbsolute(pandocPath)) {
						// 直接检查绝对路径
						await fs.promises.access(pandocPath, fs.constants.X_OK).catch(() => {
							// Windows上.exe可能被省略
							if (os.platform() === 'win32' && !pandocPath.endsWith('.exe')) {
								return fs.promises.access(pandocPath + '.exe', fs.constants.X_OK);
							}
							throw new Error();
						});
						pandocFound = true;
						console.log('使用用户设置的Pandoc路径:', pandocPath);
					} else {
						// 尝试解析相对路径
						const possiblePath = path.join(process.cwd(), pandocPath);
						await fs.promises.access(possiblePath, fs.constants.X_OK).catch(() => {
							// Windows上.exe可能被省略
							if (os.platform() === 'win32' && !possiblePath.endsWith('.exe')) {
								return fs.promises.access(possiblePath + '.exe', fs.constants.X_OK);
							}
							throw new Error();
						});
						pandocPath = possiblePath;
						pandocFound = true;
						console.log('使用相对路径找到Pandoc:', pandocPath);
					}
				} catch (e) {
					console.log('用户设置的Pandoc路径不存在或不可执行:', pandocPath);
				}
			}
			
			// 2. 如果没找到，尝试从系统PATH中查找pandoc
			if (!pandocFound) {
				console.log('尝试从系统PATH中查找Pandoc...');
				
				// 尝试从环境变量PATH中获取所有可能的路径
				const pathSeparator = os.platform() === 'win32' ? ';' : ':';
				const pathVars = process.env.PATH || '';
				const pathDirs = pathVars.split(pathSeparator);
				
				// 添加一些常见安装位置
				const commonPaths = [
					// Windows常见路径
					'C:\\Program Files\\Pandoc',
					'C:\\Pandoc',
					// macOS常见路径
					'/usr/local/bin',
					'/opt/homebrew/bin',
					'/opt/local/bin',
					// M1/M2 Mac上的Homebrew路径
					'/opt/homebrew/bin',
					// Intel Mac上的Homebrew路径
					'/usr/local/Homebrew/bin',
					// 通用Linux和macOS路径
					'/usr/bin',
					'/usr/local/bin',
					'/opt/bin'
				];
				
				// macOS特有处理：尝试读取shell配置文件获取PATH
				if (os.platform() === 'darwin') {
					try {
						// 尝试读取zsh配置（macOS 10.15+ 默认shell）
						const homeDir = os.homedir();
						const zshrcPath = path.join(homeDir, '.zshrc');
						if (fs.existsSync(zshrcPath)) {
							const zshrc = fs.readFileSync(zshrcPath, 'utf8');
							// 尝试提取PATH设置
							const pathMatches = zshrc.match(/export\s+PATH=([^:]+)/g) || [];
							for (const match of pathMatches) {
								try {
									const pathValue = match.replace(/export\s+PATH=/, '').replace(/["']/g, '');
									if (pathValue) {
										// 尝试找到可能包含homebrew或pandoc的路径
										if (pathValue.includes('homebrew') || pathValue.includes('opt') || pathValue.includes('bin')) {
											commonPaths.push(pathValue);
										}
									}
								} catch (e) {
									console.log('解析zshrc PATH失败:', e);
								}
							}
						}
						
						// 尝试从shell中直接获取PATH（注意：这在GUI应用中通常不起作用，但值得一试）
						try {
							const { stdout } = await execPromise('echo $PATH', { shell: '/bin/zsh' });
							if (stdout && stdout.toString().trim()) {
								const shellPath = stdout.toString().trim();
								const shellPathDirs = shellPath.split(':').filter(Boolean);
								shellPathDirs.forEach(dir => {
									if (!commonPaths.includes(dir)) {
										commonPaths.push(dir);
									}
								});
							}
						} catch (e) {
							console.log('无法从zsh获取PATH:', e);
						}

						// M1/M2 Mac特别检查
						const brewM1Paths = [
							'/opt/homebrew/bin',
							'/opt/homebrew/sbin',
							'/opt/homebrew/opt/pandoc/bin'
						];
						for (const brewPath of brewM1Paths) {
							if (!commonPaths.includes(brewPath)) {
								commonPaths.push(brewPath);
							}
						}
					} catch (e) {
						console.log('macOS特有路径检查失败:', e);
					}
				}
				
				// 合并所有可能的路径并去重
				const allPaths = [...new Set([...pathDirs, ...commonPaths])];
				
				// 遍历所有路径查找pandoc可执行文件
				for (const dir of allPaths) {
					if (!dir) continue;
					
					try {
						const exeName = os.platform() === 'win32' ? 'pandoc.exe' : 'pandoc';
						const exePath = path.join(dir, exeName);
						
						await fs.promises.access(exePath, fs.constants.X_OK);
						pandocPath = exePath;
						pandocFound = true;
						console.log('在路径中找到pandoc:', pandocPath);
						break;
					} catch (e) {
						// 继续尝试下一个路径
					}
				}
				
				// macOS特有方案：尝试直接使用mdfind查找
				if (!pandocFound && os.platform() === 'darwin') {
					try {
						console.log('在macOS上使用mdfind查找pandoc...');
						// 使用mdfind在系统中找到pandoc
						const { stdout } = await execPromise('mdfind -name pandoc | grep -v "\\.html$" | grep -v "\\.txt$"', { shell: '/bin/zsh' });
						if (stdout && stdout.toString().trim()) {
							const possiblePaths = stdout.toString().trim().split('\n');
							for (const possPath of possiblePaths) {
								try {
									await fs.promises.access(possPath, fs.constants.X_OK);
									pandocPath = possPath;
									pandocFound = true;
									console.log('使用mdfind找到pandoc:', pandocPath);
									break;
								} catch (e) {
									// 继续下一个
								}
							}
						}
					} catch (e) {
						console.log('mdfind查找失败:', e);
					}
				}
				
				// 3. 如果仍未找到，尝试使用which/where命令
				if (!pandocFound) {
					try {
						// 根据平台选择合适的命令
						const whichCommand = os.platform() === 'win32' ? 'where pandoc' : 'which pandoc';
						// Windows上不设置shell选项，其他平台使用合适的shell
						const options: any = {};
						if (os.platform() === 'darwin') {
							options.shell = '/bin/zsh'; // macOS现在默认使用zsh
						} else if (os.platform() === 'linux') {
							options.shell = '/bin/bash';
						}
						
						const { stdout } = await execPromise(whichCommand, options);
						if (stdout && stdout.toString().trim()) {
							// 提取第一行作为路径（where可能返回多行）
							pandocPath = stdout.toString().trim().split('\n')[0].trim();
							pandocFound = true;
							console.log('使用which/where命令找到pandoc:', pandocPath);
						}
					} catch (e) {
						console.log('使用which/where命令未找到pandoc');
					}
				}
			}
			
			// 如果仍然没找到pandoc，提供明确的错误信息
			if (!pandocFound) {
				throw new Error(
					'未找到Pandoc。虽然您可能已经安装，但插件无法检测到。\n\n' +
					'请在插件设置中输入Pandoc的完整路径(绝对路径)：\n' +
					`- Windows: 通常类似 C:\\Program Files\\Pandoc\\pandoc.exe\n` +
					`- Mac: 通常类似 /usr/local/bin/pandoc 或 /opt/homebrew/bin/pandoc\n` +
					`- Linux: 通常类似 /usr/bin/pandoc\n\n` +
					`可以在终端运行 "which pandoc"(Mac/Linux) 或 "where pandoc"(Windows) 找到确切路径。`
				);
			}
			
			// 处理PDF引擎设置 - 当格式为PDF时应用
			let extraArgs = this.settings.customArguments || '';
			if (format === 'pdf' && this.settings.pdfEngine !== 'auto') {
				extraArgs = `--pdf-engine=${this.settings.pdfEngine} ${extraArgs}`;
				console.log(`使用PDF引擎: ${this.settings.pdfEngine}`);
			}
			
			// 构建命令 - 跨平台支持
			let command = '';
			
			if (os.platform() === 'win32') {
				// Windows
				command = `"${pandocPath}" "${tempFilePath}" -o "${outputPath}" ${extraArgs}`;
			} else {
				// macOS/Linux
				command = `/bin/bash -c "${pandocPath} '${tempFilePath}' -o '${outputPath}' ${extraArgs}"`;
			}
			
			console.log(`尝试执行命令: ${command}`);
			
			// 设置环境变量和shell选项 - 跨平台兼容
			const options: any = {
				env: {
					...process.env
				}
			};
			
			// 在Windows上不设置shell选项，在其他系统上使用/bin/bash
			if (os.platform() !== 'win32') {
				options.shell = '/bin/bash';
			}
			
			// 使用execPromise执行命令
			const { stdout, stderr } = await execPromise(command, options);
			
			if (stderr && stderr.length > 0) {
				console.log('Pandoc输出警告:', stderr);
			}
			
			// 清理临时文件
			await fs.promises.unlink(tempFilePath);
			
			new Notice(`成功导出到 ${path.basename(outputPath)}`);
		} catch (error) {
			console.error('Pandoc导出错误:', error);
			
			// 提供详细错误信息和解决方案建议
			let errorMsg = error.message || '未知错误';
			
			if (errorMsg.includes('command not found') || errorMsg.includes('not recognized') || 
				errorMsg.includes('未找到Pandoc')) {
				errorMsg = `Pandoc命令未找到。\n\n请在插件设置中输入Pandoc的完整绝对路径：\n` +
					`- Windows: 通常类似 C:\\Program Files\\Pandoc\\pandoc.exe\n` +
					`- Mac: 通常类似 /usr/local/bin/pandoc 或 /opt/homebrew/bin/pandoc\n` +
					`- Linux: 通常类似 /usr/bin/pandoc\n\n` +
					`可以在终端运行 "which pandoc"(Mac/Linux) 或 "where pandoc"(Windows) 查找路径。\n` +
					`注意：即使Pandoc在环境变量中，Obsidian也可能无法识别，需要设置完整路径。`;
			} else if (errorMsg.includes('pdflatex not found') || errorMsg.includes('xelatex') || 
				errorMsg.includes('wkhtmltopdf') || errorMsg.includes('weasyprint')) {
				// 增加更多关于HTML-PDF转换的说明
				errorMsg = `生成PDF需要对应的引擎。错误: ${errorMsg}\n\n` +
					`您可以:\n` +
					`1. 安装LaTeX环境:\n` +
					`  - Mac: brew install --cask mactex-no-gui\n` +
					`  - Windows: 安装MiKTeX (https://miktex.org/)\n` +
					`  - Linux: 安装texlive-full 包\n\n` +
					`2. 或在设置中选择HTML-PDF引擎 (如wkhtmltopdf)，然后安装:\n` +
					`  - Mac: brew install wkhtmltopdf\n` +
					`  - Windows: 从 https://wkhtmltopdf.org/downloads.html 下载\n` +
					`  - Linux: sudo apt install wkhtmltopdf`;
			}
			
			console.log('尝试运行诊断以查找问题...');
			try {
				// 尝试在控制台打印更多信息以帮助诊断
				console.log('系统平台:', os.platform());
				console.log('HOME目录:', os.homedir());
				console.log('当前插件设置的Pandoc路径:', this.settings.pandocPath);
				console.log('环境变量PATH:', process.env.PATH);
				
				// 尝试列出一些关键目录的内容
				if (os.platform() === 'win32') {
					try {
						const programFiles = 'C:\\Program Files';
						if (fs.existsSync(programFiles)) {
							console.log(`${programFiles} 目录内容:`, fs.readdirSync(programFiles).filter(f => f.toLowerCase().includes('pandoc')));
						}
					} catch (e) {
						console.log('无法读取Program Files目录');
					}
				} else {
					try {
						console.log('/usr/local/bin 目录内容:', fs.readdirSync('/usr/local/bin').filter(f => f.includes('pandoc')));
					} catch (e) {
						console.log('无法读取/usr/local/bin目录');
					}
					try {
						console.log('/usr/bin 目录内容:', fs.readdirSync('/usr/bin').filter(f => f.includes('pandoc')));
					} catch (e) {
						console.log('无法读取/usr/bin目录');
					}
				}
				
				// 在开发控制台显示详细诊断信息
				new Notice(`导出失败: ${errorMsg}\n\n查看开发者控制台(Ctrl+Shift+I)获取详细信息。`);
			} catch (diagnosticError) {
				console.error('运行诊断时出错:', diagnosticError);
				new Notice(`导出失败: ${errorMsg}`);
			}
		}
	}
}

class PandocExportModal extends Modal {
	plugin: PandocExportPlugin;
	file: TFile;
	format: string;

	constructor(app: App, plugin: PandocExportPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.format = plugin.settings.defaultFormat;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.addClass('pandoc-export-modal');
		contentEl.createEl('h2', { text: 'Pandoc导出' });
		
		// File info
		contentEl.createEl('p', { text: `文件: ${this.file.name}` });
		
		// Format selection
		const formatContainer = contentEl.createDiv();
		formatContainer.createEl('label', { text: '格式: ' });
		const formatSelect = formatContainer.createEl('select');
		
		const formatLabels: Record<string, string> = {
			'pdf': 'PDF文档',
			'docx': 'Word文档',
			'html': 'HTML网页',
			'epub': 'EPUB电子书',
			'odt': 'ODT文档'
		};
		
		['pdf', 'docx', 'html', 'epub', 'odt'].forEach(format => {
			const option = formatSelect.createEl('option', {
				text: formatLabels[format],
				value: format
			});
			
			if (format === this.plugin.settings.defaultFormat) {
				option.selected = true;
				this.format = format;
			}
		});
		
		formatSelect.addEventListener('change', () => {
			this.format = formatSelect.value;
		});
		
		// Buttons
		const buttonContainer = contentEl.createDiv();
		buttonContainer.addClass('button-container');
		
		const exportButton = buttonContainer.createEl('button', {
			text: '导出'
		});
		
		exportButton.addEventListener('click', async () => {
			this.close();
			
			// Get export directory and create output path
			const exportDir = await this.plugin.getExportDirectory();
			const outputPath = path.join(
				exportDir, 
				`${this.file.basename}.${this.format}`
			);
			
			// Export the file
			await this.plugin.exportFile(this.file, this.format, outputPath);
		});
		
		const cancelButton = buttonContainer.createEl('button', {
			text: '取消'
		});
		
		cancelButton.addEventListener('click', () => {
			this.close();
		});
		
		// Add some basic styling to the buttons
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.marginTop = '1em';
		
		exportButton.style.marginRight = '0.5em';
		exportButton.addClass('mod-cta');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class PandocExportSettingTab extends PluginSettingTab {
	plugin: PandocExportPlugin;
	// 添加文件夹容器引用，用于显示目录内容
	folderContentEl: HTMLElement;

	constructor(app: App, plugin: PandocExportPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		
		containerEl.addClass('pandoc-settings');
		containerEl.createEl('h2', { text: 'Pandoc导出设置' });

		// 改进Pandoc路径设置，添加更多帮助信息和平台特定的提示
		const pandocPathSetting = new Setting(containerEl)
			.setName('Pandoc路径')
			.setDesc('设置Pandoc可执行文件的路径。强烈建议使用绝对路径以确保正常工作。')
			.addText(text => text
				.setPlaceholder(os.platform() === 'win32' ? 
					'C:\\Program Files\\Pandoc\\pandoc.exe' : 
					'/usr/local/bin/pandoc')
				.setValue(this.plugin.settings.pandocPath)
				.onChange(async (value) => {
					this.plugin.settings.pandocPath = value;
					await this.plugin.saveSettings();
				}));
		
		// 添加查看文件夹按钮
		pandocPathSetting.addButton(button => 
			button
				.setButtonText('查看文件夹')
				.onClick(async () => {
					try {
						// 获取当前路径
						const currentPath = this.plugin.settings.pandocPath;
						
						// 提取目录路径
						let dirPath = currentPath;
						if (path.isAbsolute(currentPath)) {
							// 如果是绝对路径，提取目录部分
							dirPath = path.dirname(currentPath);
						} else if (currentPath !== 'pandoc') {
							// 如果不是默认的'pandoc'且不是绝对路径，可能是相对路径
							// 尝试在常见位置查找
							const commonDirs = [
								'/usr/local/bin',
								'/usr/bin',
								'/opt/homebrew/bin',
								'/opt/local/bin'
							];
							
							for (const commonDir of commonDirs) {
								try {
									const fullPath = path.join(commonDir, currentPath);
									await fs.promises.access(fullPath);
									dirPath = commonDir;
									break;
								} catch (e) {
									// 继续检查下一个
								}
							}
						} else {
							// 如果是默认的'pandoc'，尝试查找它所在的目录
							try {
								const { stdout } = await execPromise('which pandoc', { shell: '/bin/bash' });
								if (stdout && stdout.trim()) {
									dirPath = path.dirname(stdout.trim());
								}
							} catch (e) {
								// 如果which失败，使用默认目录
								dirPath = '/usr/local/bin';
							}
						}
						
						// 确保目录存在
						try {
							await fs.promises.access(dirPath);
						} catch (e) {
							throw new Error(`目录不存在或无法访问: ${dirPath}`);
						}
						
						// 读取目录内容
						const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
						
						// 创建或清空文件夹内容容器
						if (!this.folderContentEl) {
							this.folderContentEl = containerEl.createEl('div', { cls: 'pandoc-folder-content' });
							this.folderContentEl.style.backgroundColor = 'var(--background-secondary)';
							this.folderContentEl.style.padding = '10px';
							this.folderContentEl.style.borderRadius = '5px';
							this.folderContentEl.style.marginTop = '10px';
							this.folderContentEl.style.marginBottom = '15px';
							this.folderContentEl.style.maxHeight = '200px';
							this.folderContentEl.style.overflowY = 'auto';
						} else {
							this.folderContentEl.empty();
						}
						
						// 显示目录路径
						this.folderContentEl.createEl('h4', { text: `目录内容: ${dirPath}` });
						
						// 查找确切的pandoc可执行文件
						let pandocFound = false;
						const pandocFileEl = this.folderContentEl.createEl('div');
						
						// 显示文件列表
						const fileList = this.folderContentEl.createEl('ul');
						fileList.style.paddingLeft = '20px';
						fileList.style.listStyleType = 'none';
						
						for (const file of files) {
							const fileItem = fileList.createEl('li');
							
							// 检查文件是否可能为可执行文件
							const isExecutable = async (filePath: string): Promise<boolean> => {
								try {
									const stat = await fs.promises.stat(path.join(dirPath, filePath));
									// 在Unix系统上检查执行权限
									return (stat.mode & 0o111) !== 0;
								} catch {
									return false;
								}
							};
							
							// 基于文件名猜测可执行性
							const isProbablyExecutable = !file.name.includes('.') || 
								['.sh', '.bash', '.py', '.pl', '.rb'].some(ext => file.name.endsWith(ext));
							
							// 设置图标和名称
							if (file.isDirectory()) {
								fileItem.innerHTML = `📁 <strong>${file.name}/</strong>`;
							} else {
								// 根据文件名推测是否可执行
								fileItem.innerHTML = isProbablyExecutable ? 
									`🔧 <span style="color: var(--text-accent);">${file.name}</span>` : 
									`📄 ${file.name}`;
							}
							
							// 高亮显示pandoc
							if (file.name === 'pandoc' || file.name === path.basename(currentPath)) {
								fileItem.style.backgroundColor = 'var(--background-modifier-success)';
								fileItem.style.padding = '2px 5px';
								fileItem.style.borderRadius = '3px';
								pandocFound = true;
							}
						}
						
						// 显示pandoc状态
						if (pandocFound) {
							pandocFileEl.innerHTML = `<span style="color: var(--text-success);">✅ 找到Pandoc可执行文件</span>`;
						} else {
							pandocFileEl.innerHTML = `<span style="color: var(--text-error);">❌ 未找到Pandoc可执行文件</span>`;
						}
						
						// 在文件列表前插入状态
						this.folderContentEl.insertBefore(pandocFileEl, fileList);
						
					} catch (error) {
						console.error('查看文件夹错误:', error);
						new Notice(`无法查看文件夹: ${error.message}`);
					}
				}));
		
		// 添加测试按钮
		pandocPathSetting.addButton(button => 
			button
				.setButtonText('测试Pandoc')
				.onClick(async () => {
					try {
						const pandocPath = this.plugin.settings.pandocPath;
						new Notice(`正在测试Pandoc: ${pandocPath}...`);
						
						let finalPath = pandocPath;
						let foundPath = false;
						
						// 1. 先检查用户设置的路径
						if (path.isAbsolute(pandocPath)) {
							try {
								await fs.promises.access(pandocPath, fs.constants.X_OK).catch(() => {
									// Windows上.exe可能被省略
									if (os.platform() === 'win32' && !pandocPath.endsWith('.exe')) {
										return fs.promises.access(pandocPath + '.exe', fs.constants.X_OK);
									}
									throw new Error();
								});
								finalPath = pandocPath;
								foundPath = true;
								console.log('使用用户设置的路径:', finalPath);
							} catch (e) {
								console.log('设置的路径不存在或不可执行:', pandocPath);
							}
						}
						
						// 2. 如果没找到，尝试在PATH中查找
						if (!foundPath && !path.isAbsolute(pandocPath)) {
							// macOS特有逻辑
							if (os.platform() === 'darwin') {
								// 先尝试几个常见homebrew位置
								const commonBrewPaths = [
									'/opt/homebrew/bin/pandoc',  // M1/M2 Mac
									'/usr/local/bin/pandoc',     // Intel Mac
									'/opt/local/bin/pandoc'      // MacPorts
								];
								
								for (const brewPath of commonBrewPaths) {
									try {
										await fs.promises.access(brewPath, fs.constants.X_OK);
										finalPath = brewPath;
										foundPath = true;
										console.log('在Homebrew路径找到pandoc:', finalPath);
										break;
									} catch (e) {
										// 继续尝试下一个
									}
								}
								
								// 如果还没找到，尝试mdfind
								if (!foundPath) {
									try {
										const { stdout } = await execPromise('mdfind -name pandoc | grep -v "\\.html$" | grep -v "\\.txt$"', { shell: '/bin/zsh' });
										if (stdout && stdout.toString().trim()) {
											const possiblePaths = stdout.toString().trim().split('\n');
											for (const possPath of possiblePaths) {
												try {
													await fs.promises.access(possPath, fs.constants.X_OK);
													finalPath = possPath;
													foundPath = true;
													console.log('使用mdfind找到pandoc:', finalPath);
													break;
												} catch (e) {
													// 继续下一个
												}
											}
										}
									} catch (e) {
										console.log('mdfind查找失败:', e);
									}
								}
							}
							
							// 如果还没找到，使用which/where
							if (!foundPath) {
								try {
									const whichCommand = os.platform() === 'win32' ? 'where pandoc' : 'which pandoc';
									const options: any = {};
									if (os.platform() === 'darwin') {
										options.shell = '/bin/zsh';
									} else if (os.platform() !== 'win32') {
										options.shell = '/bin/bash';
									}
									
									const { stdout } = await execPromise(whichCommand, options);
									if (stdout && stdout.toString().trim()) {
										finalPath = stdout.toString().trim().split('\n')[0].trim();
										foundPath = true;
										console.log('在PATH中找到pandoc:', finalPath);
									}
								} catch (e) {
									console.log('使用which/where命令未找到pandoc');
								}
							}
						}
						
						// 尝试执行pandoc --version
						let command = '';
						if (os.platform() === 'win32') {
							command = `"${finalPath}" --version`;
						} else {
							command = `/bin/bash -c "${finalPath} --version"`;
						}
						
						console.log(`测试命令: ${command}`);
						
						const options: any = {
							env: {
								...process.env
							}
						};
						
						if (os.platform() !== 'win32') {
							options.shell = '/bin/bash';
						}
						
						const { stdout, stderr } = await execPromise(command, options);
						
						if (stdout) {
							const version = stdout.toString().split('\n')[0];
							new Notice(`测试成功: ${version}`);
							console.log('Pandoc版本信息:', stdout);
							
							// 如果测试成功但路径不同，询问用户是否更新路径
							if (foundPath && finalPath !== pandocPath) {
								const helpEl = containerEl.createEl('div', { cls: 'pandoc-test-success' });
								helpEl.createEl('h3', { text: 'Pandoc测试成功，但路径不同' });
								helpEl.createEl('p', { text: `在系统中找到的Pandoc路径: ${finalPath}` });
								helpEl.createEl('p', { text: `当前设置的路径: ${pandocPath}` });
								
								// 添加更新按钮
								const updateBtn = helpEl.createEl('button', { text: '更新为系统路径' });
								updateBtn.style.marginRight = '10px';
								updateBtn.addEventListener('click', async () => {
									this.plugin.settings.pandocPath = finalPath;
									await this.plugin.saveSettings();
									helpEl.remove();
									new Notice(`已更新Pandoc路径为: ${finalPath}`);
									
									// 刷新设置页面
									containerEl.findAll('input').forEach(input => {
										if ((input as HTMLInputElement).value === pandocPath) {
											(input as HTMLInputElement).value = finalPath;
										}
									});
								});
								
								// 添加取消按钮
								const cancelBtn = helpEl.createEl('button', { text: '保持当前设置' });
								cancelBtn.addEventListener('click', () => {
									helpEl.remove();
								});
								
								// 添加样式
								helpEl.style.backgroundColor = 'var(--background-secondary)';
								helpEl.style.padding = '10px';
								helpEl.style.borderRadius = '5px';
								helpEl.style.marginTop = '10px';
							}
						} else {
							new Notice('Pandoc测试结果为空，可能有问题');
							console.log('测试结果为空');
						}
						
						if (stderr) {
							console.log('警告:', stderr);
						}
					} catch (error) {
						console.error('Pandoc测试错误:', error);
						new Notice(`测试失败: ${error.message || '未知错误'}\n\n请查看开发者控制台(Ctrl+Shift+I)获取详细信息。`);
						
						// 显示故障排除帮助
						const helpEl = containerEl.createEl('div', { cls: 'pandoc-test-error' });
						helpEl.createEl('h3', { text: 'Pandoc测试失败' });
						helpEl.createEl('p', { text: '请尝试以下步骤:' });
						
						const tipsList = helpEl.createEl('ol');
						
						if (os.platform() === 'win32') {
							// Windows说明
							tipsList.createEl('li', { text: '打开命令提示符，运行 "where pandoc" 查看Pandoc的完整路径' });
							tipsList.createEl('li', { text: '确保Pandoc已正确安装，在命令提示符中运行 "pandoc --version" 验证' });
							tipsList.createEl('li', { text: '在上面的输入框中输入Pandoc的完整路径 (例如 "C:\\Program Files\\Pandoc\\pandoc.exe")' });
							tipsList.createEl('li', { text: '如果还没有安装Pandoc，请访问 https://pandoc.org/installing.html 下载安装' });
							
							// 尝试诊断Windows环境变量
							try {
								const pathEnv = process.env.PATH || '';
								const pathDirs = pathEnv.split(';');
								const pandocDirs = pathDirs.filter(dir => dir.toLowerCase().includes('pandoc'));
								
								if (pandocDirs.length > 0) {
									tipsList.createEl('li', { 
										text: `您的PATH环境变量中包含这些可能的Pandoc路径: ${pandocDirs.join(', ')}，请检查这些目录中是否存在pandoc.exe` 
									});
								}
							} catch (e) {
								console.log('无法分析Windows环境变量');
							}
						} else if (os.platform() === 'darwin') {
							// macOS专用说明
							tipsList.createEl('li', { text: '打开终端，运行 "which pandoc" 查看Pandoc的完整路径' });
							tipsList.createEl('li', { text: '确保Pandoc已正确安装，在终端中运行 "pandoc --version" 验证' });
							tipsList.createEl('li', { text: '在上面的输入框中输入Pandoc的完整路径 (例如 "/opt/homebrew/bin/pandoc" 或 "/usr/local/bin/pandoc")' });
							tipsList.createEl('li', { text: '如果还没有安装Pandoc，请运行 "brew install pandoc" 安装' });
							
							// macOS特别诊断
							try {
								// 检查brew安装情况
								tipsList.createEl('li', { text: '尝试在终端运行: "brew list | grep pandoc" 查看是否已通过Homebrew安装' });
								
								// M1/M2 Mac特别提示
								if (process.arch === 'arm64') {
									tipsList.createEl('li', { text: '您使用的是M1/M2 Mac，Homebrew安装的路径通常在 /opt/homebrew/bin/pandoc' });
								} else {
									tipsList.createEl('li', { text: '您使用的是Intel Mac，Homebrew安装的路径通常在 /usr/local/bin/pandoc' });
								}
								
								// 尝试直接mdfind查找
								try {
									const { stdout } = await execPromise('mdfind -name pandoc | grep -v "\\.html$" | grep -v "\\.txt$" | head -n 5', { shell: '/bin/zsh' });
									if (stdout && stdout.toString().trim()) {
										tipsList.createEl('li', { 
											text: `系统中找到的可能Pandoc路径:\n${stdout.toString().trim()}` 
										});
									}
								} catch (e) {
									console.log('mdfind查找失败');
								}
								
								// 尝试读取zsh环境变量
								try {
									const { stdout } = await execPromise('zsh -c "echo $PATH"', { shell: '/bin/zsh' });
									if (stdout && stdout.toString().trim()) {
										tipsList.createEl('li', { 
											text: `您的zsh PATH环境变量: ${stdout.toString().trim()}` 
										});
									}
								} catch (e) {
									console.log('无法获取zsh PATH环境变量');
								}
							} catch (e) {
								console.log('macOS诊断失败:', e);
							}
						} else {
							// Linux说明
							tipsList.createEl('li', { text: '打开终端，运行 "which pandoc" 查看Pandoc的完整路径' });
							tipsList.createEl('li', { text: '确保Pandoc已正确安装，在终端中运行 "pandoc --version" 验证' });
							tipsList.createEl('li', { text: '在上面的输入框中输入Pandoc的完整路径 (例如 "/usr/bin/pandoc")' });
							tipsList.createEl('li', { text: `如果还没有安装Pandoc，请运行 "sudo apt install pandoc" 或 "sudo dnf install pandoc" 安装` });
							
							// 尝试诊断环境变量
							try {
								const { stdout } = await execPromise('echo $PATH', { shell: '/bin/bash' });
								if (stdout && stdout.toString().trim()) {
									tipsList.createEl('li', { 
										text: `您的PATH环境变量: ${stdout.toString().trim()}` 
									});
								}
							} catch (e) {
								console.log('无法获取PATH环境变量');
							}
						}
						
						// 添加样式
						helpEl.style.backgroundColor = 'var(--background-secondary)';
						helpEl.style.padding = '10px';
						helpEl.style.borderRadius = '5px';
						helpEl.style.marginTop = '10px';
					}
				}));

		new Setting(containerEl)
			.setName('默认导出目录')
			.setDesc('留空则使用仓库根目录。可以是绝对路径或相对于仓库的路径。')
			.addText(text => text
				.setPlaceholder('/导出路径')
				.setValue(this.plugin.settings.defaultExportDirectory)
				.onChange(async (value) => {
					this.plugin.settings.defaultExportDirectory = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('默认格式')
			.setDesc('默认导出格式')
			.addDropdown(dropdown => dropdown
				.addOption('pdf', 'PDF文档')
				.addOption('docx', 'Word文档')
				.addOption('html', 'HTML网页')
				.addOption('epub', 'EPUB电子书')
				.addOption('odt', 'ODT文档')
				.setValue(this.plugin.settings.defaultFormat)
				.onChange(async (value) => {
					this.plugin.settings.defaultFormat = value;
					await this.plugin.saveSettings();
				}));

		// 添加PDF引擎设置
		new Setting(containerEl)
			.setName('PDF引擎')
			.setDesc('选择将Markdown转换为PDF的引擎。默认"auto"使用pdflatex，需要安装LaTeX环境；wkhtmltopdf和weasyprint则使用HTML中间格式，安装更简单。')
			.addDropdown(dropdown => dropdown
				.addOption('auto', '自动 (使用默认引擎)')
				.addOption('wkhtmltopdf', 'wkhtmltopdf (HTML转PDF)')
				.addOption('weasyprint', 'WeasyPrint (HTML转PDF，更好的CSS支持)')
				.addOption('prince', 'Prince (高质量商业HTML转PDF)')
				.addOption('xelatex', 'XeLaTeX (支持Unicode的LaTeX)')
				.addOption('lualatex', 'LuaLaTeX (现代LaTeX)')
				.setValue(this.plugin.settings.pdfEngine)
				.onChange(async (value) => {
					this.plugin.settings.pdfEngine = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自定义Pandoc参数')
			.setDesc('传递给Pandoc的额外命令行参数')
			.addText(text => text
				.setPlaceholder('--template=my-template.latex')
				.setValue(this.plugin.settings.customArguments)
				.onChange(async (value) => {
					this.plugin.settings.customArguments = value;
					await this.plugin.saveSettings();
				}));

		// 添加安装说明
		const infoContainer = containerEl.createEl('div', { cls: 'pandoc-info-container' });
		infoContainer.style.backgroundColor = 'var(--background-secondary)';
		infoContainer.style.padding = '10px';
		infoContainer.style.borderRadius = '5px';
		infoContainer.style.marginTop = '20px';
		infoContainer.style.marginBottom = '10px';

		infoContainer.createEl('h3', { text: 'Pandoc设置帮助' });
		const tipsList = infoContainer.createEl('ul');
		tipsList.createEl('li', { text: '正确设置Pandoc路径是解决大多数导出问题的关键' });
		
		// HTML到PDF引擎说明
		const htmlPdfInfo = infoContainer.createEl('div', { cls: 'html-pdf-info' });
		htmlPdfInfo.createEl('h4', { text: 'HTML到PDF引擎说明 (推荐)' });
		const htmlPdfList = htmlPdfInfo.createEl('ul');
		htmlPdfList.createEl('li', { text: '选择wkhtmltopdf或weasyprint作为PDF引擎可避免安装大型LaTeX环境' });
		htmlPdfList.createEl('li', { text: '安装方法:' });
		
		const enginesList = htmlPdfList.createEl('ul');
		enginesList.style.paddingLeft = '20px';
		enginesList.createEl('li', { text: `wkhtmltopdf (推荐): ${os.platform() === 'darwin' ? 'brew install wkhtmltopdf' : 
			(os.platform() === 'win32' ? '从https://wkhtmltopdf.org/下载安装包' : 'sudo apt install wkhtmltopdf')}` });
		enginesList.createEl('li', { text: `weasyprint: ${os.platform() === 'darwin' ? 'pip install weasyprint' : 
			(os.platform() === 'win32' ? 'pip install weasyprint' : 'sudo apt install weasyprint')}` });

		htmlPdfList.createEl('li', { text: '适合简单文档，安装简单，不需要LaTeX环境' });
		
		// 具体操作步骤 - 跨平台支持
		const steps = infoContainer.createEl('ol');
		steps.style.paddingLeft = '20px';
		
		if (os.platform() === 'win32') {
			// Windows说明
			steps.createEl('li', { text: '在命令提示符运行命令: where pandoc' });
			steps.createEl('li', { text: '复制输出的完整路径 (通常类似于 C:\\Program Files\\Pandoc\\pandoc.exe)' });
			steps.createEl('li', { text: '将该路径粘贴到上方的"Pandoc路径"设置中' });
			steps.createEl('li', { text: '如果未安装Pandoc，请先下载安装: https://pandoc.org/installing.html' });
			tipsList.createEl('li', { text: '要导出PDF，您需要安装LaTeX，如MiKTeX: https://miktex.org/' });
		} else if (os.platform() === 'darwin') {
			// macOS说明
			steps.createEl('li', { text: '在终端运行命令: which pandoc' });
			steps.createEl('li', { text: '复制输出的完整路径 (通常类似于 /opt/homebrew/bin/pandoc)' });
			steps.createEl('li', { text: '将该路径粘贴到上方的"Pandoc路径"设置中' });
			steps.createEl('li', { text: '如果未安装Pandoc，请先运行: brew install pandoc' });
			tipsList.createEl('li', { text: '要导出PDF，您需要安装LaTeX: brew install --cask mactex-no-gui' });
		} else {
			// Linux说明
			steps.createEl('li', { text: '在终端运行命令: which pandoc' });
			steps.createEl('li', { text: '复制输出的完整路径 (通常类似于 /usr/bin/pandoc)' });
			steps.createEl('li', { text: '将该路径粘贴到上方的"Pandoc路径"设置中' });
			steps.createEl('li', { text: '如果未安装Pandoc，请使用包管理器安装: sudo apt install pandoc 或 sudo dnf install pandoc' });
			tipsList.createEl('li', { text: '要导出PDF，您需要安装LaTeX: sudo apt install texlive-full 或类似命令' });
		}
		
		tipsList.createEl('li', { text: '如果出现PDF导出错误，请确保已安装LaTeX环境' });
	}
}
