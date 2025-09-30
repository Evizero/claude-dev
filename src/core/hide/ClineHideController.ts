import chokidar, { FSWatcher } from "chokidar"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import path from "path"
import { fileExistsAtPath } from "../../utils/fs"

/**
 * Controls visibility of files in listings by applying hide patterns.
 * Uses the 'ignore' library to support standard .gitignore syntax in .clinehide files.
 * Files matched by patterns in .clinehide will be completely hidden from directory listings.
 */
export class ClineHideController {
	private cwd: string
	private hideInstance: Ignore
	private fileWatcher?: FSWatcher
	clineHideContent: string | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.hideInstance = ignore()
		this.clineHideContent = undefined
	}

	/**
	 * Initialize the controller by loading custom patterns and setting up file watcher
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		// Set up file watcher for .clinehide
		this.setupFileWatcher()
		await this.loadClineHide()
	}

	/**
	 * Set up the file watcher for .clinehide changes
	 */
	private setupFileWatcher(): void {
		const hidePath = path.join(this.cwd, ".clinehide")

		this.fileWatcher = chokidar.watch(hidePath, {
			persistent: true, // Keep the process running as long as files are being watched
			ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
			awaitWriteFinish: {
				// Wait for writes to finish before emitting events (handles chunked writes)
				stabilityThreshold: 100, // Wait 100ms for file size to remain constant
				pollInterval: 100, // Check file size every 100ms while waiting for stability
			},
			atomic: true, // Handle atomic writes where editors write to a temp file then rename
		})

		// Watch for file changes, creation, and deletion
		this.fileWatcher.on("change", () => {
			this.loadClineHide()
		})

		this.fileWatcher.on("add", () => {
			this.loadClineHide()
		})

		this.fileWatcher.on("unlink", () => {
			this.loadClineHide()
		})

		this.fileWatcher.on("error", (error) => {
			console.error("Error watching .clinehide file:", error)
		})
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
	async dispose(): Promise<void> {
		if (this.fileWatcher) {
			await this.fileWatcher.close()
			this.fileWatcher = undefined
		}
	}
}
