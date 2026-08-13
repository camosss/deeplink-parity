// Fixture: table-style route registry, Swift enum rawValue shape
enum DeepLinkRoutes: String {
    case search = "/search"
    case item = "/item"
    case best = "/item/best"   // ios-only on purpose
    case notice = "/notice"
}
