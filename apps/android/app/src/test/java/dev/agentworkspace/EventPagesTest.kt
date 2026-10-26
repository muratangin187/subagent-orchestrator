package dev.agentworkspace

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class EventPagesTest {
    @Test fun reachesCompletionBeyondFourThousandAndResumesWithoutDuplicates() = runBlocking {
        val received = mutableListOf<Long>()
        var reads = 0
        suspend fun read(after: Long): EventPage<Long> {
            reads++
            val values = ((after + 1)..4154L).take(200)
            return EventPage(values, values.lastOrNull() ?: after)
        }
        drainEventPages(0, ::read) { received.addAll(it) }
        assertEquals(4154, received.size)
        assertEquals(4154L, received.last())
        assertEquals(21, reads)
        drainEventPages(received.last(), ::read) { received.addAll(it) }
        assertEquals(4154, received.size)
        assertEquals(22, reads)
    }

    @Test fun rejectsStuckCursorBeforeAppending() = runBlocking {
        var appended = false
        try {
            drainEventPages(10, { EventPage(listOf(11L), 10) }) { appended = true }
            fail("Must reject a stuck cursor")
        } catch (_: IllegalStateException) { }
        assertFalse(appended)
    }
}
