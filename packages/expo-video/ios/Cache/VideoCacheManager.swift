import ExpoModulesCore

class VideoCacheManager {
  static let defaultMaxCacheSize = 1024_000_000 // 1GB
  static let defaultAutoCleanCache = true
  static let expoVideoCacheScheme = "expo-video-cache"
  static let expoVideoCacheDirectory = "expo-video-cache"
  static let mediaInfoSuffix = "&mediaInfo"

  static let shared = VideoCacheManager()
  private let defaults = UserDefaults.standard

  private let maxCacheSizeKey = "\(VideoCacheManager.expoVideoCacheScheme)/maxCacheSize"

  // Files currently being used/modified by the player
  private var openFiles: [URL] = []

  // We run the clean commands on a separate queue to avoid trying to remove the same value twice when two cleans are called close to each other
  private let clearingQueue = DispatchQueue(label: "\(VideoCacheManager.expoVideoCacheScheme)-dispatch-queue")

  var maxCacheSize: Int {
    get {
      defaults.maybeInteger(forKey: maxCacheSizeKey) ?? Self.defaultMaxCacheSize
    }
  }

  // TODO: Maybe find a better way to do this?
  func registerOpenFile(at url: URL) {
    if !openFiles.contains(url) {
      openFiles.append(url)
    }
  }

  func unregisterOpenFile(at url: URL) {
    openFiles.removeAll { $0 == url }
  }

  func setMaxCacheSize(newSize: Int) throws {
    if VideoManager.shared.hasRegisteredPlayers {
      throw VideoCacheException("Cannot change the cache size while there are active players")
    }

    defaults.setValue(newSize, forKey: maxCacheSizeKey)
    ensureCacheSize()
  }

  func ensureCacheSize() {
    clearingQueue.async { [weak self] in
      guard let self else {
        return
      }

      do {
        try self.limitCacheSize(to: maxCacheSize)
      } catch {
        log.warn("Failed to auto clean expo-video cache")
      }
    }
  }

  func cleanAllCache() async throws {
    return try await withCheckedThrowingContinuation { continuation in
      clearingQueue.async { [weak self] in
        do {
          try self?.deleteAllFilesInCacheDirectory()
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  func limitCacheSize(to maxSize: Int) throws {
    let allFileURLs = try getVideoFilesUrls()
    let fileURLs = allFileURLs.filter { !fileIsOpen(url: $0) }

    var totalSize: Int64 = 0
    var fileInfo = [(url: URL, size: Int64, accessDate: Date)]()

    for url in fileURLs {
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      let fileSize = attributes[.size] as? Int64 ?? 0
      let accessDate = try url.resourceValues(forKeys: [.contentAccessDateKey]).contentAccessDate ?? Date.distantPast
      totalSize += fileSize
      fileInfo.append((url: url, size: fileSize, accessDate: accessDate))
    }

    if totalSize <= maxSize {
      return
    }

    let sortedFiles = fileInfo.sorted { $0.accessDate < $1.accessDate }.reversed()

    for file in sortedFiles {
      if totalSize <= maxSize {
        continue
      }
      try removeVideoAndMimeTypeFile(at: file.url)
      totalSize -= file.size
    }
  }

  private func deleteAllFilesInCacheDirectory() throws {
    if (VideoManager.shared.hasRegisteredPlayers) {
      throw VideoCacheException("Cannot clear cache while there are active players")
    }

    guard let cacheDirectory = getCacheDirectory() else {
      return
    }

    let fileUrls = try FileManager.default.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: nil, options: [])

    for fileUrl in fileUrls {
      try removeVideoAndMimeTypeFile(at: fileUrl)
    }
  }

  private func removeVideoAndMimeTypeFile(at fileUrl: URL) throws {
    let mimeTypeFileUrl = URL(string: "\(fileUrl.relativeString)\(Self.mediaInfoSuffix)")
    try FileManager.default.removeItem(at: fileUrl)
    if let mimeTypeFileUrl, FileManager.default.fileExists(atPath: mimeTypeFileUrl.relativePath) {
      try FileManager.default.removeItem(at: mimeTypeFileUrl)
    }
  }

  func getCacheDirectorySize() throws -> UInt64 {
    guard let folderUrl = getCacheDirectory() else {
      return 0
    }
    let fileManager = FileManager.default
    var totalSize: UInt64 = 0

    guard let enumerator = fileManager.enumerator(at: folderUrl, includingPropertiesForKeys: [.fileSizeKey], options: .skipsHiddenFiles) else {
      return 0
    }

    for case let fileURL as URL in enumerator {
        let fileAttributes = try fileURL.resourceValues(forKeys: [.fileSizeKey])
        if let fileSize = fileAttributes.fileSize {
          totalSize += UInt64(fileSize)
        }
    }

    return totalSize
  }

  private func getCacheDirectory() -> URL? {
    let cacheDirs = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
    if let cacheDir = cacheDirs.first {
      let videoCacheDir = cacheDir.appendingPathComponent(VideoCacheManager.expoVideoCacheDirectory)
      return videoCacheDir
    }
    return nil
  }

  private func getVideoFilesUrls() throws -> [URL] {
    guard let videoCacheDir = getCacheDirectory() else {
      print("Failed to get the video cache directory.")
      return []
    }
    let fileUrls = (try? FileManager.default.contentsOfDirectory(at: videoCacheDir, includingPropertiesForKeys: [.contentAccessDateKey, .contentModificationDateKey], options: .skipsHiddenFiles)) ?? []
    return fileUrls.filter { !$0.absoluteString.hasSuffix(Self.mediaInfoSuffix)}
  }

  private func fileIsOpen(url: URL) -> Bool {
    return openFiles.contains { $0.relativePath == url.relativePath }
  }
}

private extension UserDefaults {
  func exists(forKey key: String) -> Bool {
    return Self.standard.object(forKey: key) != nil
  }

  func maybeInteger(forKey key: String) -> Int? {
    Self.standard.exists(forKey: key) ? Self.standard.integer(forKey: key) : nil
  }
}
