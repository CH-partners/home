from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=512)

    @field_validator("login_id")
    @classmethod
    def normalize_login_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("login_id must not be blank")
        return normalized


class CurrentUserResponse(BaseModel):
    login_id: str
    display_name: str
    role: str
