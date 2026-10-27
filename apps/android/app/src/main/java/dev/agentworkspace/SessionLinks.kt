package dev.agentworkspace

fun sessionLinkId(href: String): String? = Regex("^agent-workspace://session/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", RegexOption.IGNORE_CASE).matchEntire(href)?.groupValues?.get(1)?.lowercase()
