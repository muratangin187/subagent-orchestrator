package dev.agentworkspace
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class WorkflowTreeTest {
 private fun task(id: String, parent: String, status: String = "running") = JSONObject().put("id",id).put("parentTaskId",parent).put("title",id).put("status",status).put("updatedAt",1)
 @Test fun directAndNestedConversationScope() {
  val tasks = listOf(task("a","A"),task("b","A"),task("c","A"),task("nested","b"),task("other","B"),task("orphan","missing"))
  val rows = workflowTree(tasks,"A",true)
  assertEquals(listOf("a","b","c"), rows.filter { it.depth == 0 }.map { it.task.getString("id") })
  assertEquals(listOf("a" to 0,"b" to 0,"nested" to 1,"c" to 0),rows.map { it.task.getString("id") to it.depth })
  assertEquals(listOf("nested"),workflowTree(tasks,"b").map { it.task.getString("id") })
  assertTrue(workflowTree(tasks,"").isEmpty())
 }
 @Test fun activeDescendantsKeepTerminalAncestorsAndAvoidCycles() {
  val tasks=listOf(task("a","root","completed"),task("b","a","cancelled"),task("deep","b"),task("done","root","completed"),task("cancel","root","cancelled"),task("failed","root","failed"),task("root","deep"),task("loop","loop"))
  val rows=workflowTree(tasks,"root",true)
  assertEquals(listOf("a" to 0,"b" to 1,"deep" to 2),rows.map { it.task.getString("id") to it.depth })
  assertEquals(listOf("a","b"),rows.last().path)
  assertEquals(6,workflowTree(tasks,"root").size)
 }
 @Test fun preferenceIsScopedToConnectionAndConversation() {
  assertNotEquals(workflowPreferenceKey("one","A"),workflowPreferenceKey("two","A"))
  assertNotEquals(workflowPreferenceKey("one","A"),workflowPreferenceKey("one","B"))
 }
}
