#!/usr/bin/env python3
import asyncio
import os
import sys
import edge_tts

async def generate_legal_voice(text: str, output_path: str = "/tmp/legal_response.mp3"):
    """تبدیل متن تحلیل حقوقی به فایل صوتی روان فارسی با صدای فرید"""
    # کوتاه کردن متن برای ارائه نکات کلیدی صوتی
    speech_summary = text[:400] if len(text) > 400 else text
    communicate = edge_tts.Communicate(speech_summary, "fa-IR-FaridNeural")
    await communicate.save(output_path)
    print(f"✅ فایل صوتی مشاوره حقوقی تولید شد: {output_path} ({os.path.getsize(output_path)} بایت)")
    return output_path

if __name__ == "__main__":
    sample_text = "مطابق ماده پانصد و بیست و دو قانون آیین دادرسی مدنی و رأی وحدت رویه شماره هشتصد و هفتاد و هفت دیوان عالی کشور، خسارت تأخیر تأدیه در صورت وجود مازاد دارایی در ورشکستگی قابل مطالبه است."
    asyncio.run(generate_legal_voice(sample_text))
