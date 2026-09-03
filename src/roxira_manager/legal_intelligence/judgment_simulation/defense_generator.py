

class DefenseGenerator:


    def generate(self, claims):


        defenses=[]


        if "الزام به تنظیم سند رسمی" in claims:

            defenses.extend([

                "انکار اعتبار قرارداد",
                "عدم پرداخت کامل ثمن",
                "اشکال در مالکیت"

            ])


        return {

            "defenses":defenses,

            "status":
            "DEFENSE_READY"

        }

