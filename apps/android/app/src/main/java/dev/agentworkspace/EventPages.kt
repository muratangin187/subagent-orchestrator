package dev.agentworkspace

internal data class EventPage<T>(val items: List<T>, val nextOffset: Long)

/** Drain the server's fixed-size pages, advancing only after a validated page. */
internal suspend fun <T> drainEventPages(
    initialOffset: Long,
    read: suspend (Long) -> EventPage<T>,
    append: (List<T>) -> Unit,
) {
    var offset = initialOffset
    do {
        val page = read(offset)
        check(page.items.isEmpty() || page.nextOffset > offset) {
            "Sohbet geçmişi ilerlemedi. Yeniden dene."
        }
        append(page.items)
        offset = page.nextOffset
    } while (page.items.size == 200)
}
