from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ClientMessage(_message.Message):
    __slots__ = ("request", "input", "cancel")
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    CANCEL_FIELD_NUMBER: _ClassVar[int]
    request: ChatRequest
    input: UserInput
    cancel: CancelSignal
    def __init__(self, request: _Optional[_Union[ChatRequest, _Mapping]] = ..., input: _Optional[_Union[UserInput, _Mapping]] = ..., cancel: _Optional[_Union[CancelSignal, _Mapping]] = ...) -> None: ...

class ChatRequest(_message.Message):
    __slots__ = ("message", "working_directory", "model", "session_id")
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    WORKING_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    message: str
    working_directory: str
    model: str
    session_id: str
    def __init__(self, message: _Optional[str] = ..., working_directory: _Optional[str] = ..., model: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class UserInput(_message.Message):
    __slots__ = ("reply", "prompt_id")
    REPLY_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    reply: str
    prompt_id: str
    def __init__(self, reply: _Optional[str] = ..., prompt_id: _Optional[str] = ...) -> None: ...

class CancelSignal(_message.Message):
    __slots__ = ("reason",)
    REASON_FIELD_NUMBER: _ClassVar[int]
    reason: str
    def __init__(self, reason: _Optional[str] = ...) -> None: ...

class ServerMessage(_message.Message):
    __slots__ = ("text_chunk", "tool_start", "tool_result", "action_required", "done", "error")
    TEXT_CHUNK_FIELD_NUMBER: _ClassVar[int]
    TOOL_START_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_FIELD_NUMBER: _ClassVar[int]
    ACTION_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    text_chunk: TextChunk
    tool_start: ToolCallStart
    tool_result: ToolCallResult
    action_required: ActionRequired
    done: FinalResponse
    error: ErrorResponse
    def __init__(self, text_chunk: _Optional[_Union[TextChunk, _Mapping]] = ..., tool_start: _Optional[_Union[ToolCallStart, _Mapping]] = ..., tool_result: _Optional[_Union[ToolCallResult, _Mapping]] = ..., action_required: _Optional[_Union[ActionRequired, _Mapping]] = ..., done: _Optional[_Union[FinalResponse, _Mapping]] = ..., error: _Optional[_Union[ErrorResponse, _Mapping]] = ...) -> None: ...

class TextChunk(_message.Message):
    __slots__ = ("text",)
    TEXT_FIELD_NUMBER: _ClassVar[int]
    text: str
    def __init__(self, text: _Optional[str] = ...) -> None: ...

class ToolCallStart(_message.Message):
    __slots__ = ("tool_name", "arguments_json", "tool_use_id")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    ARGUMENTS_JSON_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    arguments_json: str
    tool_use_id: str
    def __init__(self, tool_name: _Optional[str] = ..., arguments_json: _Optional[str] = ..., tool_use_id: _Optional[str] = ...) -> None: ...

class ToolCallResult(_message.Message):
    __slots__ = ("tool_name", "output", "is_error", "tool_use_id")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    IS_ERROR_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    output: str
    is_error: bool
    tool_use_id: str
    def __init__(self, tool_name: _Optional[str] = ..., output: _Optional[str] = ..., is_error: bool = ..., tool_use_id: _Optional[str] = ...) -> None: ...

class ActionRequired(_message.Message):
    __slots__ = ("prompt_id", "question", "type")
    class ActionType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        CONFIRM_COMMAND: _ClassVar[ActionRequired.ActionType]
        REQUEST_INFORMATION: _ClassVar[ActionRequired.ActionType]
    CONFIRM_COMMAND: ActionRequired.ActionType
    REQUEST_INFORMATION: ActionRequired.ActionType
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    QUESTION_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    prompt_id: str
    question: str
    type: ActionRequired.ActionType
    def __init__(self, prompt_id: _Optional[str] = ..., question: _Optional[str] = ..., type: _Optional[_Union[ActionRequired.ActionType, str]] = ...) -> None: ...

class FinalResponse(_message.Message):
    __slots__ = ("full_text", "prompt_tokens", "completion_tokens")
    FULL_TEXT_FIELD_NUMBER: _ClassVar[int]
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    full_text: str
    prompt_tokens: int
    completion_tokens: int
    def __init__(self, full_text: _Optional[str] = ..., prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ...) -> None: ...

class ErrorResponse(_message.Message):
    __slots__ = ("message", "code")
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    message: str
    code: str
    def __init__(self, message: _Optional[str] = ..., code: _Optional[str] = ...) -> None: ...
