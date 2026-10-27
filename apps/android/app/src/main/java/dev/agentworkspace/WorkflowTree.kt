package dev.agentworkspace

import org.json.JSONObject

/** Conversation scope follows proven parent edges; orphans remain in the global jobs list. */
fun workflowTree(tasks: List<JSONObject>, rootId: String, activeOnly: Boolean = false): List<JobTreeRow> {
    if (rootId.isBlank()) return emptyList()
    val children = tasks.sortedWith(compareByDescending<JSONObject> { isActiveJob(it) }.thenByDescending { it.optLong("updatedAt") }).groupBy { it.optString("parentTaskId") }
    val seen = mutableSetOf(rootId)
    fun visit(parentId: String, depth: Int, path: List<String>): List<JobTreeRow> {
        val rows = mutableListOf<JobTreeRow>()
        children[parentId].orEmpty().forEach { task ->
            if (seen.add(task.optString("id"))) {
                val descendants = visit(task.optString("id"), depth + 1, path + task.optString("title", "İş"))
                if (!activeOnly || isActiveJob(task) || descendants.isNotEmpty()) {
                    rows.add(JobTreeRow(task, depth, path))
                    rows.addAll(descendants)
                }
            }
        }
        return rows
    }
    return visit(rootId, 0, emptyList())
}

fun workflowPreferenceKey(origin: String, rootId: String): String =
    "workflow.descendants:${origin.length}:$origin:$rootId"
