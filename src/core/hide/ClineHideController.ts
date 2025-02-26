import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"

/**
 * Controls visibility of files in listings by applying hide patterns.
 * Uses the 'ignore' library to support standard .gitignore syntax in .clinehide files.
 * Files matched by patterns in .clinehide will be completely hidden from directory listings.
 */
export class ClineHideController {
	private cwd: string
	private hideInstance: Ignore
	private disposables: vscode.Disposable[] = []
	clineHideContent: string | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.hideInstance = ignore()
		this.clineHideContent = undefined
		// Set up file watcher for .clinehide
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadClineHide()
	}

	/**
	 * Set up the file watcher for .clinehide changes
	 */
	private setupFileWatcher(): void {
		const clinehidePattern = new vscode.RelativePattern(this.cwd, ".clinehide")
		const fileWatcher = vscode.workspace.createFileSystemWatcher(clinehidePattern)

		// Watch for changes and updates
		this.disposables.push(
			fileWatcher.onDidChange(() => {
				this.loadClineHide()
			}),
			fileWatcher.onDidCreate(() => {
				this.loadClineHide()
			}),
			fileWatcher.onDidDelete(() => {
				this.loadClineHide()
			}),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(fileWatcher)
	}

	/**
	 * Load custom patterns from .clinehide if it exists
	 */
	private async loadClineHide(): Promise<void> {
		try {
			// Reset hide instance to prevent duplicate patterns
			this.hideInstance = ignore()
			const hidePath = path.join(this.cwd, ".clinehide")
			if (await fileExistsAtPath(hidePath)) {
				const content = await fs.readFile(hidePath, "utf8")
				this.clineHideContent = content
				this.hideInstance.add(content)
				// Also hide the .clinehide file itself
				this.hideInstance.add(".clinehide")
			} else {
				this.clineHideContent = undefined
			}
		} catch (error) {
			console.error("Unexpected error loading .clinehide:", error)
		}
	}

	/**
	 * Check if a file should be shown in listings
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file should be shown, false if it should be hidden
	 */
	shouldShow(filePath: string): boolean {
		// Always show if .clinehide does not exist
		if (!this.clineHideContent) {
			return true
		}
		try {
			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath).toPosix()

			// Ignore expects paths to be path.relative()'d
			// Return false if the file matches a hide pattern
			return !this.hideInstance.ignores(relativePath)
		} catch (error) {
			// Allow showing all files outside cwd
			return true
		}
	}

	/**
	 * Filter an array of paths, removing those that should be hidden
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of paths that should be shown
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					show: this.shouldShow(p),
				}))
				.filter((x) => x.show)
				.map((x) => x.path)
		} catch (error) {
			console.error("Error filtering paths:", error)
			return paths // Unlike ignore which fails closed, we default to showing files if there's an error
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}
}
