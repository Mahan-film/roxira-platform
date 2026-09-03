

from src.roxira_manager.dev_agent.architecture_audit.scanner import ModuleScanner

from src.roxira_manager.dev_agent.architecture_audit.v2.smart_duplicate import SmartDuplicateDetector



files=ModuleScanner().scan()


result=SmartDuplicateDetector().scan(files)



print({

"duplicates":result,

"count":len(result)

})

