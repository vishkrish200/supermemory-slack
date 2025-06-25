/**
 * Slack File Attachment Handler Service
 *
 * Provides comprehensive file processing capabilities for Slack attachments,
 * including authentication, metadata extraction, content processing, and
 * secure download handling.
 */

import type { SlackFile } from "../types";
import type { SlackApiClient } from "./client";

export interface ProcessedFile {
  id: string;
  name: string;
  title?: string;
  mimetype: string;
  size: number;
  url: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  content?: string; // For text files
  metadata: {
    type: FileType;
    category: FileCategory;
    isImage: boolean;
    isDocument: boolean;
    isVideo: boolean;
    isAudio: boolean;
    user: string;
    timestamp?: string;
    previewAvailable: boolean;
    downloadable: boolean;
  };
}

export interface FileDownloadResult {
  success: boolean;
  data?: ArrayBuffer;
  contentType?: string;
  filename?: string;
  size?: number;
  error?: string;
}

export interface FileProcessingOptions {
  downloadFiles?: boolean;
  extractTextContent?: boolean;
  generateThumbnails?: boolean;
  maxFileSize?: number; // in bytes
  allowedMimeTypes?: string[];
  extractMetadata?: boolean;
}

export enum FileType {
  IMAGE = "image",
  DOCUMENT = "document",
  VIDEO = "video",
  AUDIO = "audio",
  ARCHIVE = "archive",
  CODE = "code",
  SPREADSHEET = "spreadsheet",
  PRESENTATION = "presentation",
  PDF = "pdf",
  TEXT = "text",
  OTHER = "other",
}

export enum FileCategory {
  MEDIA = "media",
  DOCUMENT = "document",
  CODE = "code",
  ARCHIVE = "archive",
  OTHER = "other",
}

export class SlackFileHandler {
  private readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB default
  private readonly SUPPORTED_TEXT_EXTRACTION = [
    "text/plain",
    "text/csv",
    "text/html",
    "text/markdown",
    "application/json",
    "text/javascript",
    "text/css",
  ];

  constructor(
    private readonly defaultOptions: FileProcessingOptions = {
      downloadFiles: false,
      extractTextContent: true,
      generateThumbnails: false,
      maxFileSize: 50 * 1024 * 1024,
      extractMetadata: true,
    }
  ) {}

  /**
   * Process a single file attachment
   */
  async processFile(
    file: SlackFile,
    slackClient: SlackApiClient,
    token?: string,
    options?: FileProcessingOptions
  ): Promise<ProcessedFile> {
    const opts = { ...this.defaultOptions, ...options };

    const fileType = this.determineFileType(file.mimetype, file.name);
    const category = this.determineFileCategory(fileType);

    const processedFile: ProcessedFile = {
      id: file.id,
      name: file.name,
      title: file.title,
      mimetype: file.mimetype,
      size: file.size,
      url: file.url_private,
      downloadUrl: file.url_private_download,
      metadata: {
        type: fileType,
        category,
        isImage: fileType === FileType.IMAGE,
        isDocument: [
          FileType.DOCUMENT,
          FileType.PDF,
          FileType.SPREADSHEET,
          FileType.PRESENTATION,
        ].includes(fileType),
        isVideo: fileType === FileType.VIDEO,
        isAudio: fileType === FileType.AUDIO,
        user: file.user,
        previewAvailable: this.supportsPreview(file.mimetype),
        downloadable: file.size <= (opts.maxFileSize || this.MAX_FILE_SIZE),
      },
    };

    // Extract text content if requested and supported
    if (opts.extractTextContent && this.supportsTextExtraction(file.mimetype)) {
      try {
        const content = await this.extractTextContent(file, slackClient, token);
        if (content) {
          processedFile.content = content;
        }
      } catch (error) {
        console.warn(
          `Failed to extract text content from file ${file.id}:`,
          error
        );
      }
    }

    return processedFile;
  }

  /**
   * Process multiple file attachments
   */
  async processFiles(
    files: SlackFile[],
    slackClient: SlackApiClient,
    token?: string,
    options?: FileProcessingOptions
  ): Promise<ProcessedFile[]> {
    const opts = { ...this.defaultOptions, ...options };

    // Filter files by allowed types and size limits
    const allowedFiles = files.filter((file) => {
      if (
        opts.allowedMimeTypes &&
        !opts.allowedMimeTypes.includes(file.mimetype)
      ) {
        return false;
      }

      if (file.size > (opts.maxFileSize || this.MAX_FILE_SIZE)) {
        console.warn(
          `File ${file.name} exceeds size limit: ${file.size} bytes`
        );
        return false;
      }

      return true;
    });

    // Process files with concurrency control
    const BATCH_SIZE = 3;
    const results: ProcessedFile[] = [];

    for (let i = 0; i < allowedFiles.length; i += BATCH_SIZE) {
      const batch = allowedFiles.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map((file) =>
        this.processFile(file, slackClient, token, options).catch((error) => {
          console.error(`Error processing file ${file.id}:`, error);
          // Return a basic processed file even if processing fails
          return this.createBasicProcessedFile(file);
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches
      if (i + BATCH_SIZE < allowedFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Download file content
   */
  async downloadFile(
    file: SlackFile | ProcessedFile,
    _slackClient: SlackApiClient,
    token?: string
  ): Promise<FileDownloadResult> {
    try {
      const downloadUrl =
        "downloadUrl" in file
          ? file.downloadUrl
          : (file as SlackFile).url_private_download;

      if (!downloadUrl) {
        return {
          success: false,
          error: "No download URL available",
        };
      }

      // For Slack files, we need to use authenticated requests
      const response = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Supermemory-Slack-Connector/1.0",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || file.mimetype;

      return {
        success: true,
        data,
        contentType,
        filename: file.name,
        size: data.byteLength,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown download error",
      };
    }
  }

  /**
   * Extract text content from supported file types
   */
  private async extractTextContent(
    file: SlackFile,
    slackClient: SlackApiClient,
    token?: string
  ): Promise<string | null> {
    if (!this.supportsTextExtraction(file.mimetype)) {
      return null;
    }

    // For small text files, download and extract content
    if (file.size <= 1024 * 1024) {
      // 1MB limit for text extraction
      const downloadResult = await this.downloadFile(file, slackClient, token);

      if (downloadResult.success && downloadResult.data) {
        try {
          const decoder = new TextDecoder("utf-8");
          return decoder.decode(downloadResult.data);
        } catch (error) {
          console.warn(
            `Failed to decode text content for file ${file.id}:`,
            error
          );
        }
      }
    }

    return null;
  }

  /**
   * Determine file type from mimetype and filename
   */
  private determineFileType(mimetype: string, filename: string): FileType {
    // Check mimetype first
    if (mimetype.startsWith("image/")) return FileType.IMAGE;
    if (mimetype.startsWith("video/")) return FileType.VIDEO;
    if (mimetype.startsWith("audio/")) return FileType.AUDIO;
    if (mimetype.startsWith("text/")) return FileType.TEXT;

    // Specific mimetypes
    if (mimetype === "application/pdf") return FileType.PDF;
    if (mimetype.includes("json")) return FileType.CODE;
    if (mimetype.includes("javascript")) return FileType.CODE;
    if (mimetype.includes("typescript")) return FileType.CODE;

    // Document types
    if (
      mimetype.includes("document") ||
      mimetype.includes("word") ||
      mimetype.includes("rtf")
    )
      return FileType.DOCUMENT;

    // Spreadsheet types
    if (
      mimetype.includes("spreadsheet") ||
      mimetype.includes("excel") ||
      mimetype.includes("sheet")
    )
      return FileType.SPREADSHEET;

    // Presentation types
    if (
      mimetype.includes("presentation") ||
      mimetype.includes("powerpoint") ||
      mimetype.includes("slide")
    )
      return FileType.PRESENTATION;

    // Archive types
    if (
      mimetype.includes("zip") ||
      mimetype.includes("tar") ||
      mimetype.includes("compress")
    )
      return FileType.ARCHIVE;

    // Check file extension as fallback
    const ext = filename.toLowerCase().split(".").pop();
    switch (ext) {
      case "js":
      case "ts":
      case "jsx":
      case "tsx":
      case "py":
      case "rb":
      case "php":
      case "java":
      case "cpp":
      case "c":
      case "h":
      case "css":
      case "scss":
      case "less":
      case "sql":
      case "sh":
      case "bash":
      case "yml":
      case "yaml":
      case "xml":
        return FileType.CODE;

      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "svg":
      case "webp":
        return FileType.IMAGE;

      case "mp4":
      case "avi":
      case "mov":
      case "wmv":
      case "webm":
        return FileType.VIDEO;

      case "mp3":
      case "wav":
      case "ogg":
      case "flac":
      case "m4a":
        return FileType.AUDIO;

      case "pdf":
        return FileType.PDF;

      case "doc":
      case "docx":
      case "odt":
      case "rtf":
        return FileType.DOCUMENT;

      case "xls":
      case "xlsx":
      case "ods":
      case "csv":
        return FileType.SPREADSHEET;

      case "ppt":
      case "pptx":
      case "odp":
        return FileType.PRESENTATION;

      case "zip":
      case "tar":
      case "gz":
      case "rar":
      case "7z":
        return FileType.ARCHIVE;

      case "txt":
      case "md":
      case "log":
        return FileType.TEXT;

      default:
        return FileType.OTHER;
    }
  }

  /**
   * Determine file category from type
   */
  private determineFileCategory(type: FileType): FileCategory {
    switch (type) {
      case FileType.IMAGE:
      case FileType.VIDEO:
      case FileType.AUDIO:
        return FileCategory.MEDIA;

      case FileType.DOCUMENT:
      case FileType.PDF:
      case FileType.SPREADSHEET:
      case FileType.PRESENTATION:
      case FileType.TEXT:
        return FileCategory.DOCUMENT;

      case FileType.CODE:
        return FileCategory.CODE;

      case FileType.ARCHIVE:
        return FileCategory.ARCHIVE;

      default:
        return FileCategory.OTHER;
    }
  }

  /**
   * Check if file type supports preview
   */
  private supportsPreview(mimetype: string): boolean {
    return (
      mimetype.startsWith("image/") ||
      mimetype.startsWith("text/") ||
      mimetype === "application/pdf" ||
      mimetype.includes("json")
    );
  }

  /**
   * Check if file type supports text extraction
   */
  private supportsTextExtraction(mimetype: string): boolean {
    return this.SUPPORTED_TEXT_EXTRACTION.includes(mimetype);
  }

  /**
   * Create a basic processed file when full processing fails
   */
  private createBasicProcessedFile(file: SlackFile): ProcessedFile {
    const fileType = this.determineFileType(file.mimetype, file.name);
    const category = this.determineFileCategory(fileType);

    return {
      id: file.id,
      name: file.name,
      title: file.title,
      mimetype: file.mimetype,
      size: file.size,
      url: file.url_private,
      downloadUrl: file.url_private_download,
      metadata: {
        type: fileType,
        category,
        isImage: fileType === FileType.IMAGE,
        isDocument: [
          FileType.DOCUMENT,
          FileType.PDF,
          FileType.SPREADSHEET,
          FileType.PRESENTATION,
        ].includes(fileType),
        isVideo: fileType === FileType.VIDEO,
        isAudio: fileType === FileType.AUDIO,
        user: file.user,
        previewAvailable: this.supportsPreview(file.mimetype),
        downloadable: file.size <= this.MAX_FILE_SIZE,
      },
    };
  }

  /**
   * Generate file summary for Supermemory
   */
  generateFileSummary(files: ProcessedFile[]): string {
    if (files.length === 0) return "";

    const summary: string[] = [];

    // Group files by category
    const grouped = files.reduce((acc, file) => {
      const category = file.metadata.category;
      if (!acc[category]) acc[category] = [];
      acc[category].push(file);
      return acc;
    }, {} as Record<FileCategory, ProcessedFile[]>);

    for (const [category, categoryFiles] of Object.entries(grouped)) {
      if (categoryFiles.length === 1) {
        const file = categoryFiles[0];
        summary.push(`📎 ${file.name} (${file.metadata.type})`);

        if (file.content) {
          summary.push(
            `Content preview: ${file.content.substring(0, 200)}${
              file.content.length > 200 ? "..." : ""
            }`
          );
        }
      } else {
        summary.push(
          `📎 ${categoryFiles.length} ${category} files: ${categoryFiles
            .map((f) => f.name)
            .join(", ")}`
        );
      }
    }

    return summary.join("\n");
  }

  /**
   * Get file URLs for Supermemory metadata
   */
  getFileUrls(files: ProcessedFile[]): string[] {
    return files
      .filter((file) => file.metadata.downloadable)
      .map((file) => file.url);
  }
}
