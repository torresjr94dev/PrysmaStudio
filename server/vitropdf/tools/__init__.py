from __future__ import annotations

from .base import Artifact, StepContext, Tool
from .convert import ConvertTool
from .ocr import OcrTool

TOOLS: dict[str, Tool] = {tool.name: tool for tool in (ConvertTool(), OcrTool())}

__all__ = ["TOOLS", "Artifact", "StepContext", "Tool"]
