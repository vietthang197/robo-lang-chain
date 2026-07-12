package com.thanglv.robolangchain.mcp;

import com.thanglv.robolangchain.mcp.toolResponse.CurrentDateTime;
import dev.langchain4j.agent.tool.ReturnBehavior;
import dev.langchain4j.agent.tool.SearchBehavior;
import dev.langchain4j.agent.tool.Tool;

import java.time.ZonedDateTime;

public class InternalTool {
    @Tool(name = "get_current_datetime", value = """
            Returns the current date and time from the MCP server.
            Use this tool whenever accurate current date or time information is required. This includes answering questions about today's date, the current time, the current year, month, day, weekday, or performing calculations relative to the current moment (for example, "3 days from now", "next Monday", or "how many days until a specific date").
            Do not estimate or assume the current date or time. Always call this tool when an accurate current timestamp is needed.
            The response contains:
            Year, month, and day of month
            Hour, minute, and second
            Day of week
            Day of year
            ISO week of year
            Leap year indicator
            Unix epoch timestamp in milliseconds
            IANA time zone identifier (for example, Asia/Ho_Chi_Minh)
            UTC offset (for example, +07:00)
            ISO 8601 date-time string with time zone offset
            """,
            returnBehavior = ReturnBehavior.TO_LLM,
            searchBehavior = SearchBehavior.SEARCHABLE)
    public CurrentDateTime mcpTime() {
        ZonedDateTime now = ZonedDateTime.now();
        return new CurrentDateTime (
                now.getYear(),
                now.getMonthValue(),
                now.getDayOfMonth(),
                now.getHour(),
                now.getMinute(),
                now.getSecond(),
                now.toInstant().toEpochMilli(),
                now.getZone().getId(),
                now.getOffset().getId(),
                now.toOffsetDateTime().toString(),
                now.getDayOfWeek().getValue(),
                now.getDayOfWeek().name(),
                now.getDayOfYear(),
                now.get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR),
                now.toLocalDate().isLeapYear()
        );
    }
}
