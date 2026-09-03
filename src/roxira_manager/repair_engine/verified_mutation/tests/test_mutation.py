

from src.roxira_manager.repair_engine.verified_mutation.mutation import VerifiedMutation


engine=VerifiedMutation()


print(

engine.execute(

"opencode",

"output_apps/smart_judge/src/engines/legal_drafter.py",

"""

Implement SmartJudgeEngine.

Requirements:

- Keep SmartJudgeDrafter unchanged.
- Add SmartJudgeEngine.
- Add generate_legal_document.
- Required keys:
title
parties
legal_basis
formal_text

After editing run import validation.

"""

)

)

