from enum import StrEnum


class RoomState(StrEnum):
    LOBBY = "LOBBY"
    TUTORIAL = "TUTORIAL"
    PLAYING = "PLAYING"
    PERSONAL_SUMMARY = "PERSONAL_SUMMARY"
    PODIUM = "PODIUM"


# FSM transition logic — implemented in M2 (Issue #17)
