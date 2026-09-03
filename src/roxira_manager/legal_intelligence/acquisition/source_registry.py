

class LegalSourceRegistry:


    SOURCES={

        "civil_code":{
            "name":"قانون مدنی",
            "type":"LAW",
            "priority":1
        },


        "civil_procedure":{
            "name":"آیین دادرسی مدنی",
            "type":"PROCEDURE",
            "priority":1
        },


        "registration_law":{
            "name":"قانون ثبت اسناد و املاک",
            "type":"LAW",
            "priority":1
        },


        "supreme_court":{
            "name":"آرای وحدت رویه دیوان عالی کشور",
            "type":"PRECEDENT",
            "priority":1
        }

    }



    @classmethod
    def list_sources(cls):

        return cls.SOURCES

