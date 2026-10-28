package mcp

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
)

// Server handles the MCP JSON-RPC 2.0 communication over stdio.
type Server struct {
	reader *bufio.Reader
	writer io.Writer
	logger *log.Logger
}

// NewServer creates a new MCP server connected to reader and writer.
func NewServer(r io.Reader, w io.Writer) *Server {
	return &Server{
		reader: bufio.NewReader(r),
		writer: w,
		logger: log.New(os.Stderr, "[SVGTuber-MCP] ", log.LstdFlags),
	}
}

// Run executes the stdio JSON-RPC loop until EOF or error.
func (s *Server) Run() error {
	s.logger.Println("SVGTuber MCP server started")
	for {
		payload, err := s.readMessage()
		if err != nil {
			if err == io.EOF {
				s.logger.Println("Client disconnected (EOF)")
				return nil
			}
			s.logger.Printf("Read error: %v\n", err)
			return err
		}

		if len(strings.TrimSpace(string(payload))) == 0 {
			continue
		}

		s.handlePayload(payload)
	}
}

// readMessage supports both raw newline-delimited JSON and Content-Length framed JSON.
func (s *Server) readMessage() ([]byte, error) {
	for {
		lineBytes, err := s.reader.ReadBytes('\n')
		if err != nil {
			return nil, err
		}

		line := strings.TrimRight(string(lineBytes), "\r\n")
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Check for LSP/MCP Content-Length framing
		if strings.HasPrefix(strings.ToLower(line), "content-length:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				length, err := strconv.Atoi(strings.TrimSpace(parts[1]))
				if err == nil && length > 0 {
					// Read header terminator (empty line)
					for {
						headerLine, err := s.reader.ReadString('\n')
						if err != nil {
							return nil, err
						}
						if strings.TrimRight(headerLine, "\r\n") == "" {
							break
						}
					}

					buf := make([]byte, length)
					_, err := io.ReadFull(s.reader, buf)
					if err != nil {
						return nil, err
					}
					return buf, nil
				}
			}
		}

		// Otherwise, line is pure JSON
		return lineBytes, nil
	}
}

func (s *Server) handlePayload(payload []byte) {
	var req JSONRPCRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.sendError(nil, CodeParseError, "Parse error: "+err.Error())
		return
	}

	if req.JSONRPC == "" {
		req.JSONRPC = "2.0"
	}

	// Notifications have no ID and do not expect a response
	if len(req.ID) == 0 && req.Method == "notifications/initialized" {
		s.logger.Println("Client initialized notification received")
		return
	}

	switch req.Method {
	case "initialize":
		res := InitializeResult{
			ProtocolVersion: "2024-11-05",
			Capabilities: ServerCapabilities{
				Tools:     &ToolsCapability{ListChanged: false},
				Resources: &ResourcesCapability{Subscribe: false, ListChanged: false},
			},
			ServerInfo: ServerInfo{
				Name:    "svgtuber-mcp",
				Version: "0.0.7",
			},
			Instructions: ServerInstructions,
		}
		s.sendResult(req.ID, res)

	case "ping":
		s.sendResult(req.ID, map[string]any{})

	case "resources/list":
		res := ResourcesListResult{
			Resources: GetResourceDefinitions(),
		}
		s.sendResult(req.ID, res)

	case "resources/read":
		var readParams ReadResourceParams
		if err := json.Unmarshal(req.Params, &readParams); err != nil {
			s.sendError(req.ID, CodeInvalidParams, "Invalid params: "+err.Error())
			return
		}
		res, err := ReadResourceByURI(readParams.URI)
		if err != nil {
			s.sendError(req.ID, CodeInvalidParams, err.Error())
			return
		}
		s.sendResult(req.ID, res)

	case "tools/list":
		res := ToolsListResult{
			Tools: GetToolDefinitions(),
		}
		s.sendResult(req.ID, res)

	case "tools/call":
		var callParams CallToolParams
		if err := json.Unmarshal(req.Params, &callParams); err != nil {
			s.sendError(req.ID, CodeInvalidParams, "Invalid params: "+err.Error())
			return
		}

		toolRes, err := ExecuteTool(callParams.Name, callParams.Arguments)
		if err != nil {
			s.sendError(req.ID, CodeInternalError, err.Error())
			return
		}
		s.sendResult(req.ID, toolRes)

	default:
		s.sendError(req.ID, CodeMethodNotFound, "Method not found: "+req.Method)
	}
}

func (s *Server) sendResult(id json.RawMessage, result any) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	s.writeResponse(resp)
}

func (s *Server) sendError(id json.RawMessage, code int, msg string) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &JSONRPCError{
			Code:    code,
			Message: msg,
		},
	}
	s.writeResponse(resp)
}

func (s *Server) writeResponse(resp JSONRPCResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		s.logger.Printf("Failed to marshal response: %v", err)
		return
	}

	data = append(data, '\n')
	_, _ = s.writer.Write(data)
}
