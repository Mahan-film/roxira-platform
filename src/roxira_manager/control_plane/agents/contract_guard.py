
class AgentContractError(Exception):
    pass


class AgentContractGuard:

    ALLOWED_COMMAND_TYPES = (str, list, tuple)

    @staticmethod
    def validate(agent, command):

        if not isinstance(agent, str):
            raise AgentContractError(
                f"Invalid agent type: {type(agent).__name__}"
            )

        if not isinstance(command, AgentContractGuard.ALLOWED_COMMAND_TYPES):
            raise AgentContractError(
                f"Invalid command type: {type(command).__name__}"
            )

        if isinstance(command, str) and not command.strip():
            raise AgentContractError(
                "Empty command"
            )

        if isinstance(command, (list, tuple)) and len(command) == 0:
            raise AgentContractError(
                "Empty command list"
            )

        return {
            "status": "CONTRACT_VALID",
            "agent": agent
        }
