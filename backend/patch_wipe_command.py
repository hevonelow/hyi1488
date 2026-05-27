with open('C:/Users/пк/Desktop/ии деньги/backend/main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Находим обработчик команды /start или любое удобное место для вставки новой команды
# Давайте добавим обработчик команды /wipe в главный бот (main_dp)
wipe_command_code = """
@main_dp.message(Command("wipe"))
async def main_wipe_db(message: types.Message):
    # Очищаем базу данных
    import sqlite3
    import os
    try:
        db_path = os.path.join(os.path.dirname(__file__), 'database.sqlite')
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users")
        conn.commit()
        conn.close()
        await message.answer("🧹 База данных пользователей успешно очищена прямо на сервере!")
    except Exception as e:
        await message.answer(f"❌ Ошибка очистки базы: {e}")

@main_dp.message(CommandStart())"""

content = content.replace('@main_dp.message(CommandStart())', wipe_command_code)

with open('C:/Users/пк/Desktop/ии деньги/backend/main.py', 'w', encoding='utf-8') as f:
    f.write(content)
print("Added /wipe command to main.py!")
