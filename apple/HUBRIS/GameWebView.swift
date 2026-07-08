import SwiftUI
import WebKit

/// Fullscreen WKWebView that loads the bundled game (web/index.html).
///
/// The bundle is served through a custom `hubris://` URL scheme instead of
/// `file://` because WKWebView blocks ES-module scripts from file origins
/// (modules require CORS and file origins are opaque). A custom scheme gives
/// the game a proper origin, which also makes localStorage persistence
/// (Mirror of Hubris, unlocks, settings) reliable across launches.
struct GameWebView: UIViewRepresentable {
    func makeCoordinator() -> WebFolderSchemeHandler { WebFolderSchemeHandler() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(context.coordinator, forURLScheme: "hubris")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 10 / 255, green: 13 / 255, blue: 24 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor

        #if DEBUG
        // Inspect from Safari ▸ Develop menu on a connected Mac (iOS 16.4+).
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        webView.load(URLRequest(url: URL(string: "hubris://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Serves files from the bundled `web/` folder for `hubris://app/...` requests.
final class WebFolderSchemeHandler: NSObject, WKURLSchemeHandler {
    private static let mimeTypes: [String: String] = [
        "html": "text/html",
        "js": "text/javascript",
        "mjs": "text/javascript",
        "css": "text/css",
        "json": "application/json",
        "webmanifest": "application/manifest+json",
        "png": "image/png",
        "jpg": "image/jpeg",
        "svg": "image/svg+xml",
        "ico": "image/x-icon",
        "wasm": "application/wasm",
        "woff": "font/woff",
        "woff2": "font/woff2",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        guard let webRoot = Bundle.main.url(forResource: "web", withExtension: nil) else {
            task.didFailWithError(missingBuildError())
            return
        }
        let fileURL = webRoot.appendingPathComponent(String(path.dropFirst()))

        guard let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(missingBuildError(path: path))
            return
        }

        let ext = fileURL.pathExtension.lowercased()
        let mime = Self.mimeTypes[ext] ?? "application/octet-stream"
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                "Cache-Control": "no-cache",
            ]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func missingBuildError(path: String = "web/") -> NSError {
        NSError(
            domain: "HUBRIS",
            code: 404,
            userInfo: [NSLocalizedDescriptionKey:
                "\(path) not found in the app bundle. Run `npm run build:ios` in the repository root, then build again."]
        )
    }
}
