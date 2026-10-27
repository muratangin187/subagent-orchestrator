package dev.agentworkspace
import org.junit.Assert.*
import org.junit.Test
class SessionLinksTest {
 @Test fun exactTaskIdsOnly() {
  val id = "161c0520-1faf-4bea-a888-2bc252e1b470"
  assertEquals(id, sessionLinkId("agent-workspace://session/$id"))
  assertEquals(id, sessionLinkId("AGENT-WORKSPACE://SESSION/${id.uppercase()}"))
  listOf("https://session/$id", "agent-workspace://session/title", "agent-workspace://session/$id?x=1", "agent-workspace://session/$id/extra", "file:///etc/passwd").forEach { assertNull(sessionLinkId(it)) }
 }
}
