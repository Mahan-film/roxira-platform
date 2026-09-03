

from src.roxira_manager.self_improvement.self_correction_loop import SelfCorrectionLoop



loop = SelfCorrectionLoop()



critic = {

"errors":[

"Wrong legal citation",

"Missing jurisdiction analysis"

]

}



result = loop.improve(

"AI legal answer",

critic

)



print(result)

