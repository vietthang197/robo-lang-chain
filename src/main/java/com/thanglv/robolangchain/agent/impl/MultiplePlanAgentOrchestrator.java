package com.thanglv.robolangchain.agent.impl;

import com.thanglv.robolangchain.agent.AgentOrchestrator;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.rag.RetrievalAugmentor;
import org.bsc.langgraph4j.CompiledGraph;
import org.bsc.langgraph4j.StateGraph;
import org.bsc.langgraph4j.action.AsyncNodeAction;
import org.bsc.langgraph4j.state.AgentState;
import org.bsc.langgraph4j.state.StateSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/**
 * Implementation của Agent Orchestrator sử dụng mô hình Multiple Plan
 * Luồng xử lý: Planner -> Tool Executor -> Grader -> (loop nếu cần) -> Final Response
 */
@Service
public class MultiplePlanAgentOrchestrator implements AgentOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(MultiplePlanAgentOrchestrator.class);

    // Constants cho các node trong graph
    private static final String PLANNER_NODE = "planner";
    private static final String TOOL_EXECUTOR_NODE = "tool_executor";
    private static final String GRADER_NODE = "grader";
    private static final String FINAL_RESPONSE_NODE = "final_response";

    private final ChatModel chatModel;
    private final RetrievalAugmentor retrievalAugmentor;
    private final CompiledGraph<AgentState> compiledGraph;

    public MultiplePlanAgentOrchestrator(ChatModel chatModel, 
                                         RetrievalAugmentor retrievalAugmentor) {
        this.chatModel = chatModel;
        this.retrievalAugmentor = retrievalAugmentor;
        this.compiledGraph = buildGraph();
    }

    /**
     * Xây dựng workflow graph với mô hình Multiple Plan
     */
    private CompiledGraph<AgentState> buildGraph() {
        
        StateGraph<AgentState> workflow = new StateGraph<>();

        // Thêm các node vào graph
        workflow.addNode(PLANNER_NODE, createPlannerNode());
        workflow.addNode(TOOL_EXECUTOR_NODE, createToolExecutorNode());
        workflow.addNode(GRADER_NODE, createGraderNode());
        workflow.addNode(FINAL_RESPONSE_NODE, createFinalResponseNode());

        // Thiết lập điểm bắt đầu
        workflow.setEntryPoint(PLANNER_NODE);

        // Thiết lập conditional edges dựa trên kết quả từ planner
        workflow.addConditionalEdges(
            PLANNER_NODE,
            this::routeFromPlanner,
            Map.of(
                "execute_tools", TOOL_EXECUTOR_NODE,
                "answer_directly", FINAL_RESPONSE_NODE
            )
        );

        // Từ tool executor chuyển sang grader
        workflow.addEdge(TOOL_EXECUTOR_NODE, GRADER_NODE);

        // Từ grader có thể quay lại tool executor hoặc chuyển sang final response
        workflow.addConditionalEdges(
            GRADER_NODE,
            this::routeFromGrader,
            Map.of(
                "need_more_info", TOOL_EXECUTOR_NODE,
                "sufficient", FINAL_RESPONSE_NODE
            )
        );

        // Compile graph
        return workflow.compile();
    }

    /**
     * Node Planner: Phân tích yêu cầu và lên kế hoạch
     */
    private AsyncNodeAction<AgentState> createPlannerNode() {
        return (state) -> {
            log.info("=== PLANNER NODE ===");
            String input = state.value("input", "");
            
            // Sử dụng LLM để phân tích và lên kế hoạch
            String planningPrompt = """
                Bạn là một AI Assistant thông minh. Hãy phân tích yêu cầu sau và quyết định chiến lược trả lời:
                
                Yêu cầu: %s
                
                Nếu yêu cầu cần tìm kiếm thông tin từ tài liệu hoặc sử dụng công cụ bên ngoài, hãy trả về:
                ACTION: execute_tools
                PLAN: [mô tả các bước cần thực hiện]
                
                Nếu có thể trả lời trực tiếp bằng kiến thức sẵn có, hãy trả về:
                ACTION: answer_directly
                RESPONSE: [câu trả lời]
                
                Chỉ trả về kết quả theo format trên, không thêm giải thích.
                """.formatted(input);

            String response = chatModel.generate(planningPrompt);
            
            Map<String, Object> newState = new HashMap<>(state.data());
            newState.put("plan", response);
            newState.put("planner_decided", response.contains("execute_tools") ? "execute_tools" : "answer_directly");
            
            if (response.contains("answer_directly")) {
                int responseStart = response.indexOf("RESPONSE:");
                if (responseStart != -1) {
                    newState.put("direct_answer", response.substring(responseStart + 9).trim());
                }
            }
            
            return newState;
        };
    }

    /**
     * Node Tool Executor: Thực thi các công cụ (RAG, MCP tools, etc.)
     */
    private AsyncNodeAction<AgentState> createToolExecutorNode() {
        return (state) -> {
            log.info("=== TOOL EXECUTOR NODE ===");
            String input = state.value("input", "");
            String plan = state.value("plan", "");
            
            // Ở đây sẽ tích hợp với RAG và các tools khác
            // Hiện tại chỉ lưu lại thông tin đã thực thi
            Map<String, Object> newState = new HashMap<>(state.data());
            newState.put("tools_executed", true);
            newState.put("execution_log", "Executed plan: " + plan);
            
            // Trong tương lai có thể gọi retrievalAugmentor ở đây
            // và lưu kết quả vào state
            newState.put("retrieved_context", "Context will be retrieved here");
            
            return newState;
        };
    }

    /**
     * Node Grader: Đánh giá kết quả từ tool execution
     */
    private AsyncNodeAction<AgentState> createGraderNode() {
        return (state) -> {
            log.info("=== GRADER NODE ===");
            String input = state.value("input", "");
            boolean toolsExecuted = state.value("tools_executed", false);
            String context = state.value("retrieved_context", "");
            
            // Sử dụng LLM để đánh giá xem thông tin đã đủ chưa
            String gradingPrompt = """
                Đánh giá xem thông tin thu thập được đã đủ để trả lời câu hỏi chưa:
                
                Câu hỏi: %s
                Thông tin thu thập: %s
                
                Nếu thông tin đã đủ, trả về: RESULT: sufficient
                Nếu cần thêm thông tin, trả về: RESULT: need_more_info
                """.formatted(input, context);

            String response = chatModel.generate(gradingPrompt);
            
            Map<String, Object> newState = new HashMap<>(state.data());
            newState.put("grader_decision", response.contains("sufficient") ? "sufficient" : "need_more_info");
            newState.put("grade_result", response);
            
            return newState;
        };
    }

    /**
     * Node Final Response: Tạo câu trả lời cuối cùng
     */
    private AsyncNodeAction<AgentState> createFinalResponseNode() {
        return (state) -> {
            log.info("=== FINAL RESPONSE NODE ===");
            String input = state.value("input", "");
            String directAnswer = state.value("direct_answer", null);
            String context = state.value("retrieved_context", "");
            
            String finalResponse;
            
            if (directAnswer != null) {
                finalResponse = directAnswer;
            } else {
                // Sử dụng LLM để tổng hợp câu trả lời từ context
                String synthesisPrompt = """
                    Dựa trên thông tin sau, hãy trả lời câu hỏi một cách tự nhiên và hữu ích:
                    
                    Câu hỏi: %s
                    
                    Thông tin: %s
                    
                    Trả lời:
                    """.formatted(input, context);
                
                finalResponse = chatModel.generate(synthesisPrompt);
            }
            
            Map<String, Object> newState = new HashMap<>(state.data());
            newState.put("final_output", finalResponse);
            newState.put("completed", true);
            
            return newState;
        };
    }

    /**
     * Routing logic từ Planner node
     */
    private String routeFromPlanner(AgentState state) {
        String decision = state.value("planner_decided", "answer_directly");
        log.info("Routing from Planner: {}", decision);
        return decision;
    }

    /**
     * Routing logic từ Grader node
     */
    private String routeFromGrader(AgentState state) {
        String decision = state.value("grader_decision", "sufficient");
        log.info("Routing from Grader: {}", decision);
        return decision;
    }

    @Override
    public String process(String input) {
        log.info("Starting Multiple Plan Agent Workflow for input: {}", input);
        
        // Khởi tạo state ban đầu
        Map<String, Object> initialStateMap = new HashMap<>();
        initialStateMap.put("input", input);
        initialStateMap.put("step_count", 0);
        AgentState initialState = new AgentState(initialStateMap);
        
        // Chạy graph
        AgentState finalState = compiledGraph.invoke(initialState);
        
        String result = finalState.value("final_output", 
            "Xin lỗi, tôi không thể xử lý yêu cầu của bạn.");
        
        log.info("Workflow completed. Result: {}", result);
        return result;
    }

    @Override
    public StateSnapshot getCurrentState() {
        return compiledGraph.getState();
    }

    @Override
    public CompiledGraph<AgentState> getCompiledGraph() {
        return compiledGraph;
    }
}
