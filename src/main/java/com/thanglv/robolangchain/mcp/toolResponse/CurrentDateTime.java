package com.thanglv.robolangchain.mcp.toolResponse;

public record CurrentDateTime(
        Integer year,
        Integer month,
        Integer dayOfMonth,
        Integer hour,
        Integer minute,
        Integer second,
        Long epochMillis,
        String timezone,
        String offset,
        String iso8601,
        Integer dayOfWeek,
        String dayOfWeekName,
        Integer dayOfYear,
        Integer weekOfYear,
        Boolean leapYear
) {
}
