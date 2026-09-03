

from src.roxira_manager.repair_engine.patch_writer.patch_writer import PatchWriter


contract={

"component":"SmartJudgeEngine",

"contract":{

"class":"SmartJudgeEngine",

"method":"generate_legal_document",

"required_keys":[

"title",

"parties",

"legal_basis",

"formal_text"

]

}

}


writer=PatchWriter()


print(

writer.create_patch(contract)

)

