package com.thanglv.robolangchain.agent;

import org.bsc.langgraph4j.CompiledGraph;
import org.bsc.langgraph4j.state.AgentState;
import org.bsc.langgraph4j.state.StateSnapshot;

/**
 * Interface định nghĩa AI Agent Orchestrator sử dụng LangGraph4J
 * Hỗ trợ mô hình Multiple Plan với các bước: Planning -> Tool Execution -> Grading
 */
public interface AgentOrchestrator {

    /**
     * Xử lý yêu cầu người dùng thông qua workflow đa bước
     * @param input Đầu vào từ người dùng
     * @return Phản hồi từ agent
     */
    String process(String input);

    /**
     * Lấy trạng thái hiện tại của graph
     * @return StateSnapshot chứa thông tin các node đã thực thi
     */
    StateSnapshot getCurrentState();

    /**
     * Compiled graph của workflow
     * @return CompiledGraph đã được build
     */
    CompiledGraph<AgentState> getCompiledGraph();
}
