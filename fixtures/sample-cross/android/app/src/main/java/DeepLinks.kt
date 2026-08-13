// Fixture: table-style route registry, Kotlin enum-argument shape
enum class DeepLinks(val path: String) {
    SEARCH("/search"),
    ITEM("/item"),
    NOTICE("/notice"),
    EVENTS("/events"),   // android-only on purpose
}
