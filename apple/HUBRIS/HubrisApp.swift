import SwiftUI

/// HUBRIS — native iOS shell.
///
/// The entire game is the static web build bundled under `web/`;
/// this app is a thin fullscreen WKWebView around it. See ../README.md
/// for the developer & deployment guide.
@main
struct HubrisApp: App {
    var body: some Scene {
        WindowGroup {
            GameWebView()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .background(Color(red: 10 / 255, green: 13 / 255, blue: 24 / 255))
        }
    }
}
