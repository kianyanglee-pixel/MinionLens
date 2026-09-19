import os
from dotenv import load_dotenv
#from google import genai
from openai import OpenAI

load_dotenv()
#gemini
#client = genai.Client()
#DEFAULT_MODEL = "gemini_2.5_flash"
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

#you guys can test whether the API is connected or not. Later pls remove the comment. 
#this file is for connecting any kind llm, this file will be further used for the proejct's operations


