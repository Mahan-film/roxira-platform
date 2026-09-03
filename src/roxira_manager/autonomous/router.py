

class AutonomousRouter:


    def select_agent(self, task):

        task = task.lower()


        if "دادخواست" in task or "لایحه" in task:
            return "legal_drafting"


        if "تحلیل" in task or "پرونده" in task:
            return "legal_reasoning"


        if "مدرک" in task or "pdf" in task:
            return "document_reader"


        return "general_agent"

