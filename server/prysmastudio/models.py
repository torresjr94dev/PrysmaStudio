from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

TesseractLanguage = Annotated[str, StringConstraints(pattern=r"^[a-z]{3}(_[a-z]{3,4})?$")]
OutputName = Annotated[
    str, StringConstraints(min_length=1, max_length=200, pattern=r'^[^\\/:*?"<>|\x00-\x1f]+$')
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ConvertStep(_Strict):
    tool: Literal["convert"]
    to: Literal["pdf"] = "pdf"


class OcrStep(_Strict):
    tool: Literal["ocr"]
    languages: list[TesseractLanguage] = Field(min_length=1, max_length=4)
    mode: Literal["skip-text", "redo", "force"] = "skip-text"
    deskew: bool = False
    output: Literal["pdf", "pdfa-2b"] = "pdf"

    @model_validator(mode="after")
    def _check(self) -> OcrStep:
        if len(set(self.languages)) != len(self.languages):
            raise ValueError("los idiomas no pueden repetirse")
        if self.mode == "redo" and self.deskew:
            raise ValueError("deskew no es compatible con mode=redo")
        return self


Step = Annotated[ConvertStep | OcrStep, Field(discriminator="tool")]


class JobSpec(_Strict):
    steps: list[Step] = Field(min_length=1, max_length=4)
    output_name: OutputName | None = Field(default=None, alias="outputName")
