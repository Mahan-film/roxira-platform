

from src.roxira_manager.dev_agent.error_intelligence.diagnosis import ErrorDiagnosis



engine=ErrorDiagnosis()



sample={

"stderr":
"AttributeError: object has no attribute analyze"

}



print(

engine.analyze(sample)

)

