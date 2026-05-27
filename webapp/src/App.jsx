import React, { useState, useEffect, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { mockTasks } from './tasks';
import { feedNames, feedTasks } from './feedData';
import { Zap, AlertTriangle, Lock, Plus, Users, History, UserCircle, Activity, Check, X, Wallet, Clock } from 'lucide-react';
import './index.css';

const API_URL = '/api';

const getFakeUserInitials = (name) => {
  return name.slice(0, 2).toUpperCase();
};

const getDailyStats = () => {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  
  const lcg = (s) => {
    let m = 0x80000000;
    let a = 1103515245;
    let c = 12345;
    s = (a * s + c) % m;
    return s / m;
  };

  const rand1 = lcg(seed);
  const rand2 = lcg(seed + 1);

  const bestResult = Math.floor(678393 + rand1 * (1450000 - 678393));
  const bestResultFormatted = bestResult.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  const maxMultiplier = (49.7 + rand2 * (85.0 - 49.7)).toFixed(1);

  return { bestResult: bestResultFormatted, maxMultiplier: `x${maxMultiplier}` };
};

function App() {
  const dailyStats = getDailyStats();
  const [balance, setBalance] = useState(0);
  const [power, setPower] = useState(1);
  const [selectedTask, setSelectedTask] = useState(null);
  
  // States: 'idle', 'searching', 'accept_task', 'configure_generation', 'generating', 'scammed', 'result_view'
  const [appState, setAppState] = useState('idle');
  const [lastResult, setLastResult] = useState(null);
  const [showTopUp, setShowTopUp] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');
  const [profileData, setProfileData] = useState(null);
  
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [withdrawalHistory, setWithdrawalHistory] = useState([]);
  const [showWithdrawSuccess, setShowWithdrawSuccess] = useState(false);
  
  const [accessDenied, setAccessDenied] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userInitials, setUserInitials] = useState('');
  const [userAvatar, setUserAvatar] = useState(null);
  
  const [userPrompt, setUserPrompt] = useState('');
  const [promptError, setPromptError] = useState('');
  
  const [feedEvents, setFeedEvents] = useState([]);
  const [searchProgress, setSearchProgress] = useState(0);
  const [checkedTasks, setCheckedTasks] = useState(0);
  const [timer, setTimer] = useState(90);

  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  useEffect(() => {
    try {
      if (WebApp && WebApp.ready) {
        WebApp.ready();
        WebApp.expand();
      }
      
      let tgUser = WebApp?.initDataUnsafe?.user || window?.Telegram?.WebApp?.initDataUnsafe?.user;
      
      // Manual hash parsing just in case SDK fails
      if (!tgUser && window.location.hash.includes('tgWebAppData')) {
        try {
          const params = new URLSearchParams(window.location.hash.slice(1));
          const tgWebAppData = params.get('tgWebAppData');
          if (tgWebAppData) {
            const dataParams = new URLSearchParams(tgWebAppData);
            const userStr = dataParams.get('user');
            if (userStr) {
              tgUser = JSON.parse(userStr);
            }
          }
        } catch (err) {
          console.warn("Manual hash parsing failed", err);
        }
      }

      if (tgUser) {
        setUserId(tgUser.id);
        const name = tgUser.first_name ? tgUser.first_name : (tgUser.username ? `@${tgUser.username}` : 'User');
        setUserName(name);
        setUserInitials((tgUser.first_name || tgUser.username || 'U').charAt(0).toUpperCase());
        if (tgUser.photo_url) {
          setUserAvatar(tgUser.photo_url);
        }
      } else {
        setUserId(-1); // Special ID to indicate "not in telegram"
      }
    } catch (e) {
      console.warn("WebApp init failed", e);
      setUserId(-1);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetch(`${API_URL}/user/${userId}`)
      .then(async (res) => {
        if (res.status === 403) {
          setAccessDenied(true);
          throw new Error('Access denied');
        }
        return res.json();
      })
      .then(data => {
        if (data.status === 'scammed') setAppState('scammed');
        setBalance(data.balance !== undefined ? data.balance : 0);
      })
      .catch(console.error);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    if (activeTab === 'profile') {
      fetch(`${API_URL}/profile/${userId}`)
        .then(res => res.json())
        .then(data => setProfileData(data))
        .catch(console.error);
    }
  }, [activeTab, userId, appState]);

  // Live Feed Logic
  useEffect(() => {
    const generateEvent = () => {
      const hour = new Date().getHours();
      let timeout;
      if (hour >= 4 && hour < 7) timeout = Math.random() * 15000 + 15000;
      else if (hour >= 18 && hour <= 23) timeout = Math.random() * 3000 + 2000;
      else timeout = Math.random() * 5000 + 5000;

      timerRef.current = setTimeout(() => {
        const randomName = feedNames[Math.floor(Math.random() * feedNames.length)];
        const randomTask = feedTasks[Math.floor(Math.random() * feedTasks.length)];
        const fakeReward = randomTask.reward || [2500, 4400, 5225, 7924, 4100, 5600, 12000, 25000][Math.floor(Math.random() * 8)];
        const newEvent = { id: Date.now(), user: randomName, init: getFakeUserInitials(randomName), desc: randomTask.title, reward: fakeReward };
        
        setFeedEvents(prev => [newEvent, ...prev].slice(0, 15));
        generateEvent();
      }, timeout);
    };

    generateEvent();
    const initialFeed = Array(15).fill(null).map((_, i) => {
      const randomName = feedNames[Math.floor(Math.random() * feedNames.length)];
      const randomTask = feedTasks[Math.floor(Math.random() * feedTasks.length)];
      return {
        id: i, user: randomName, init: getFakeUserInitials(randomName), desc: randomTask.title,
        reward: randomTask.reward || [2500, 4400, 5225, 7924, 4100, 5600][Math.floor(Math.random() * 6)]
      };
    });
    setFeedEvents(initialFeed);
    return () => clearTimeout(timerRef.current);
  }, []);

  const startSearch = () => {
    setAppState('searching');
    setSearchProgress(0);
    setCheckedTasks(0);
    
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setTimeout(() => {
          setSelectedTask(mockTasks[Math.floor(Math.random() * mockTasks.length)]);
          setAppState('accept_task');
          setTimer(90);
          startCountdown();
        }, 500);
      }
      setSearchProgress(progress);
      setCheckedTasks(Math.floor(progress / 10));
    }, 300);
  };

  const startCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          setAppState('idle');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    if (appState === 'idle' || appState === 'scammed') {
      if (countdownRef.current) clearInterval(countdownRef.current);
    }
  }, [appState]);

  const handleGenerate = () => {
    if (!selectedTask) return;
    
    const taskKeywords = (selectedTask.title + ' ' + selectedTask.description).toLowerCase();
    const inputWords = userPrompt.toLowerCase().split(' ').filter(w => w.length > 2);
    
    let isMatch = false;
    for (let word of inputWords) {
      if (taskKeywords.includes(word)) {
        isMatch = true;
        break;
      }
    }

    if (!isMatch || userPrompt.trim().length < 3) {
      setPromptError('Запрос не распознан. Клиент просил другое!');
      if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('error');
      return;
    }

    setPromptError('');
    setAppState('generating');
    if (countdownRef.current) clearInterval(countdownRef.current);

    setTimeout(() => {
      fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, power, taskId: selectedTask.id })
      })
      .then(res => res.json())
      .then(data => {
        if (data.scammed) {
          setAppState('scammed');
          setBalance(data.newBalance);
          if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('error');
        } else if (data.insufficientFunds) {
          setPromptError('Недостаточно средств. Куратор отправил сообщение.');
          setShowTopUp(true);
          setAppState('idle');
          if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('error');
        } else {
          setBalance(data.newBalance);
          setLastResult({
            title: selectedTask.title,
            image: selectedTask.image,
            cost: data.cost,
            payout: data.payout,
            profit: data.profit,
            success: data.success
          });
          setSelectedTask(null);
          setUserPrompt('');
          setAppState('result_view');
          if (WebApp?.HapticFeedback?.notificationOccurred) {
            WebApp.HapticFeedback.notificationOccurred(data.success ? 'success' : 'error');
          }
        }
      })
      .catch(err => {
        console.error(err);
        setAppState('idle');
      });
    }, 2500);
  };

  // Helper for power cost
  const getCost = (p) => {
    if (p === 1) return 2500;
    if (p === 2) return 5000;
    if (p === 3) return 7000;
    return 7000 + Math.round((p - 3) * 1216.4948);
  };

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center space-y-4">
        <AlertTriangle className="w-16 h-16 text-pink-500" />
        <h1 className="text-2xl font-bold text-white">Доступ закрыт</h1>
        <p className="text-white/70">Вы еще не подписались на канал или ваш аккаунт был заблокирован.</p>
        <p className="text-sm text-pink-400">Вернитесь в бота и выполните условия.</p>
      </div>
    );
  }

  if (userId === -1) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center space-y-4">
        <AlertTriangle className="w-16 h-16 text-pink-500" />
        <h1 className="text-2xl font-bold text-white">Ошибка запуска</h1>
        <p className="text-white/70">Приложение необходимо запускать только через специальную кнопку в боте Telegram.</p>
        <p className="text-sm text-pink-400">Пожалуйста, зайдите в бота и нажмите кнопку "🚀 Запустить работу".</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center space-y-4">
        <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-white/70">Загрузка данных Телеграм...</p>
      </div>
    );
  }

  if (appState === 'scammed') {
    return (
      <div className="scam-screen">
        <AlertTriangle size={64} color="#ef4444" className="glitch" data-text="SYSTEM ERROR" />
        <h1 className="glitch" data-text="FATAL ERROR">FATAL ERROR</h1>
        <p>Мощности превысили критический предел. Сервер перегружен.</p>
        <p style={{marginTop: 20, color: 'var(--text-secondary)'}}>
          Проверьте сообщения от куратора в боте. Аккаунт временно заморожен.
        </p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* HEADER */}
      <div className="top-header fade-in">
        <div className="user-info">
          <div className="avatar">
            {userAvatar ? <img src={userAvatar} alt="Avatar" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} /> : userInitials}
          </div>
          <span className="username">{userName}</span>
        </div>
        <div className="balance-info">
          <span className="balance-text">{balance.toLocaleString('ru-RU')} ₸</span>
          <button className="add-btn" onClick={() => setShowTopUp(true)}><Plus size={16} strokeWidth={3} /></button>
          <div className="status-pill">Базовый</div>
        </div>
      </div>

      {activeTab === 'tasks' && appState === 'idle' && (
        <div className="fade-in">
          {/* HERO SECTION */}
          <div className="hero-section">
            <h1>Готов заработать <span className="highlight">прямо сейчас?</span></h1>
            <p className="subtitle">Новые задания обновляются каждые несколько минут</p>
            
            <div className="stats-row">
              <div className="stat-box">
                <div className="stat-value highlight">{dailyStats.bestResult} ₸</div>
                <div className="stat-label">ЛУЧШИЙ РЕЗУЛЬТАТ ДНЯ</div>
              </div>
              <div className="stat-box">
                <div className="stat-value highlight">{dailyStats.maxMultiplier}</div>
                <div className="stat-label">МАКС. МНОЖИТЕЛЬ</div>
              </div>
            </div>
            
            <div className="online-status">
              <div className="live-dot"></div>
              <span>1 696 исполнителей онлайн</span>
            </div>

            <button className="main-action-btn pulse-anim" onClick={startSearch}>
              <Zap size={20} fill="currentColor" /> Найти задание
            </button>
          </div>

          {/* LIVE FEED */}
          <div className="feed-section">
            <div className="feed-title">
              <div className="live-badge"><div className="live-dot"></div> LIVE</div>
              <span>ПРЯМО СЕЙЧАС ЗАРАБАТЫВАЮТ</span>
              <span className="time-filter">за 10 мин</span>
            </div>
            
            <div className="feed-list">
              {feedEvents.map(ev => (
                <div key={ev.id} className="feed-item slide-in">
                  <div className="feed-avatar">{ev.init}</div>
                  <div className="feed-content">
                    <div className="feed-name">{ev.user}</div>
                    <div className="feed-desc">{ev.desc}</div>
                  </div>
                  <div className="feed-reward">+{ev.reward} ₸</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && appState === 'searching' && (
        <div className="search-card fade-in">
          <div className="search-header">
            <div className="spinner"></div>
            <span>Подбираем доступные задания</span>
          </div>
          
          <div className="search-graphics">
            <div className="search-bg-text">Образ<br/><span style={{opacity: 0.5}}>жизни</span></div>
            <div className="lightning-icon bounce-anim">⚡</div>
            <div className="search-status-badge">Анализ</div>
            <div className="search-more-text">🔥 Еще больше заданий</div>
            <div className="progress-bar-container">
              <div className="progress-bar" style={{width: `${searchProgress}%`}}></div>
            </div>
          </div>
          
          <div className="search-footer">
            <div className="dots-anim"><span>.</span><span>.</span><span>.</span></div>
            <div className="checked-text">Проверено заданий: <span className="highlight">{checkedTasks}</span></div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && appState === 'accept_task' && selectedTask && (
        <div className="task-view-card fade-in">
          <div className="task-category-header">
            <div className="category-title">{selectedTask.title}</div>
            <div className="check-badge"><Check size={16} /></div>
          </div>
          
          <div className="task-description-box">
            <div className="desc-label">ЧТО ДОЛЖНО БЫТЬ НА ФОТОГРАФИИ</div>
            <div className="desc-content">
              {selectedTask.description}
            </div>
          </div>

          <div className="multiplier-row">
            <span>Макс. множитель</span>
            <span className="highlight" style={{fontSize: 18, fontWeight: 700}}>до x2.4</span>
          </div>

          <div className="timer-row">
            <Clock size={14} /> На принятие осталось {timer} сек.
          </div>

          <div className="action-buttons">
            <button className="main-action-btn" onClick={() => setAppState('configure_generation')}>
              <Check size={20} /> Принять
            </button>
            <button className="secondary-action-btn" onClick={() => setAppState('idle')}>
              Отклонить
            </button>
          </div>
          <button className="ghost-btn" onClick={() => setAppState('idle')}>Отменить поиск</button>
        </div>
      )}

      {activeTab === 'tasks' && appState === 'configure_generation' && selectedTask && (
        <div className="task-view-card fade-in">
          <div className="task-description-box" style={{marginBottom: 16}}>
            <div className="desc-label">ЧТО ДОЛЖНО БЫТЬ НА ФОТОГРАФИИ</div>
            <div className="desc-content">
              {selectedTask.description}
            </div>
          </div>

          {balance < getCost(power) && (
            <div className="error-box">
              <Wallet size={20} />
              <div>
                <strong>Баланс ниже минимальной суммы</strong>
                <p>Минимальная стоимость генерации сейчас недоступна.</p>
              </div>
            </div>
          )}

          <div className="power-config-section">
            <div className="slider-header">
              <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                <Zap size={18} className="highlight" /> 
                <span style={{fontSize: 18, fontWeight: 700}}>Мощность</span>
              </div>
              <span className="highlight" style={{fontSize: 24, fontWeight: 800}}>{power}%</span>
            </div>
            
            <input 
              type="range" 
              min="1" max="100" 
              value={power} 
              onChange={(e) => setPower(parseInt(e.target.value))}
              className="accent-slider"
            />
            <div className="slider-labels">
              <span>1%</span>
              <span>50%</span>
              <span>100%</span>
            </div>

            <div className="cost-stepper">
              <button onClick={() => setPower(Math.max(1, power - 1))}>-</button>
              <div className="cost-value">{getCost(power).toLocaleString('ru-RU')} ₸</div>
              <button onClick={() => setPower(Math.min(100, power + 1))}>+</button>
            </div>
            <div className="cost-subtitle">Стоимость генерации: 2 500—125 000 ₸</div>
          </div>

          <div className="prompt-section">
            <label>Введите промпт (докажите, что поняли задачу):</label>
            <input 
              type="text" 
              value={userPrompt}
              onChange={(e) => { setUserPrompt(e.target.value); setPromptError(''); }}
              placeholder="Команда снимает на смартфон..."
              className={promptError ? 'error-input' : ''}
            />
            {promptError && <div className="error-text">{promptError}</div>}
          </div>

          <button 
            className="main-action-btn" 
            onClick={handleGenerate}
            style={{opacity: balance < getCost(power) ? 0.5 : 1}}
          >
            <Lock size={18} /> Начать работу ({timer} с)
          </button>
        </div>
      )}

      {activeTab === 'tasks' && appState === 'generating' && (
        <div className="generating-overlay fade-in">
          <div className="big-spinner"></div>
          <h2>Нейросеть в работе...</h2>
          <p>Вычисляем результат на мощности {power}%</p>
        </div>
      )}

      {activeTab === 'tasks' && appState === 'result_view' && lastResult && (
        <div className="task-view-card fade-in">
          <div className="task-category-header" style={{justifyContent: 'center', marginBottom: 24}}>
            <div className="category-title" style={{fontSize: 20, color: lastResult.success ? 'var(--accent)' : 'var(--danger)'}}>
              {lastResult.success ? 'Генерация завершена' : 'Генерация отклонена'}
            </div>
          </div>
          
          <div style={{
            width: '100%', height: '240px', borderRadius: '16px', 
            background: lastResult.success ? 'linear-gradient(135deg, #4a154b, #2a164a)' : 'linear-gradient(135deg, #4a1515, #2a1616)', 
            marginBottom: '24px', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', color: 'rgba(255,255,255,0.5)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden', position: 'relative'
          }}>
            <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: lastResult.success ? `url("${lastResult.image}")` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.6, mixBlendMode: 'overlay'}}></div>
            <div style={{zIndex: 1, textAlign: 'center', padding: '0 20px'}}>
              {lastResult.success ? (
                <Check size={48} color="#00E676" style={{marginBottom: 8}}/>
              ) : (
                <X size={48} color="#ff3b30" style={{marginBottom: 8}}/>
              )}
              <div style={{fontWeight: 600, color: '#fff'}}>
                {lastResult.success ? lastResult.title : 'Картинка не точно подошла под контекст.'}
              </div>
            </div>
          </div>

          <div style={{background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '16px', marginBottom: '24px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px'}}>
              <span style={{color: 'var(--text-secondary)'}}>Списано за генерацию:</span>
              <span style={{color: '#ff3b30', fontWeight: 600}}>- {lastResult.cost.toLocaleString('ru-RU')} ₸</span>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px'}}>
              <span style={{color: 'var(--text-secondary)'}}>Выплата от заказчика:</span>
              <span style={{color: '#00e676', fontWeight: 600}}>+ {lastResult.payout.toLocaleString('ru-RU')} ₸</span>
            </div>
            <div style={{height: '1px', background: 'var(--panel-border)', margin: '12px 0'}}></div>
            <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '16px'}}>
              <span style={{fontWeight: 600}}>Чистая прибыль:</span>
              <span style={{fontWeight: 800, color: lastResult.success ? 'var(--accent)' : 'var(--danger)'}}>
                {lastResult.profit > 0 ? '+' : ''}{lastResult.profit.toLocaleString('ru-RU')} ₸
              </span>
            </div>
          </div>

          <button className="main-action-btn" onClick={() => setAppState('idle')}>
            {lastResult.success ? 'Отлично' : 'Понятно'}
          </button>
        </div>
      )}

      {activeTab === 'profile' && profileData && (
        <div className="task-view-card fade-in" style={{marginTop: 20}}>
          <div style={{textAlign: 'center', marginBottom: 24}}>
            <div className="avatar" style={{width: 80, height: 80, fontSize: 32, margin: '0 auto 16px'}}>
              {userAvatar ? <img src={userAvatar} alt="Avatar" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} /> : userInitials}
            </div>
            <h2 style={{fontSize: 24, fontWeight: 800, marginBottom: 4}}>{userName}</h2>
            <div className="status-pill" style={{display: 'inline-block'}}>ID: {profileData.id}</div>
          </div>

          <div className="stats-row" style={{background: 'var(--nav-bg)', borderRadius: 16, padding: 16, marginBottom: 24}}>
            <div className="stat-box">
              <div className="stat-label">БАЛАНС</div>
              <div className="stat-value" style={{fontSize: 20}}>{profileData.balance.toLocaleString('ru-RU')} ₸</div>
            </div>
            <div className="stat-box" style={{borderLeft: '1px solid var(--panel-border)', paddingLeft: 16}}>
              <div className="stat-label">ЧИСТАЯ ПРИБЫЛЬ</div>
              <div className="stat-value" style={{fontSize: 20, color: 'var(--success)'}}>
                {profileData.net_profit > 0 ? '+' : ''}{profileData.net_profit.toLocaleString('ru-RU')} ₸
              </div>
            </div>
          </div>

          <div style={{background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16}}>
            <h3 style={{fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16}}>Статистика генераций</h3>
            
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 12}}>
              <span>Всего запусков:</span>
              <strong>{profileData.generations_total}</strong>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 12}}>
              <span>Успешно:</span>
              <strong style={{color: 'var(--success)'}}>{profileData.generations_success}</strong>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
              <span>Отбраковано:</span>
              <strong style={{color: 'var(--danger)'}}>{profileData.generations_failed}</strong>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'withdraw' && (
        <div className="task-view-card fade-in" style={{marginTop: 20, textAlign: 'center'}}>
          <Wallet size={64} color="var(--accent)" style={{marginBottom: 16}} />
          <h2 style={{fontSize: 24, fontWeight: 800, marginBottom: 8}}>Вывод средств</h2>
          <p style={{color: 'var(--text-secondary)', marginBottom: 24}}>
            Минимальная сумма вывода составляет 25 000 ₸.
          </p>
          
          <div style={{background: 'var(--nav-bg)', borderRadius: 16, padding: 16, marginBottom: 24}}>
            <div style={{fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4}}>Доступно для вывода</div>
            <div style={{fontSize: 32, fontWeight: 800, color: 'var(--accent)'}}>{balance.toLocaleString('ru-RU')} ₸</div>
          </div>

          <div className="prompt-section" style={{textAlign: 'left', marginBottom: 16}}>
            <label>Номер карты:</label>
            <input 
              type="text" 
              value={cardNumber}
              onChange={(e) => {
                let val = e.target.value.replace(/\D/g, '');
                val = val.substring(0, 16);
                val = val.replace(/(\d{4})(?=\d)/g, '$1 ');
                setCardNumber(val);
              }}
              placeholder="0000 0000 0000 0000"
            />
          </div>

          <div className="prompt-section" style={{textAlign: 'left', marginBottom: 24}}>
            <label>Сумма к выводу (₸):</label>
            <input 
              type="number" 
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="25000"
            />
          </div>

          <button 
            className="main-action-btn" 
            onClick={() => {
              const amount = parseInt(withdrawAmount);
              if (isNaN(amount) || amount < 25000) {
                if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('error');
                alert("Минимальная сумма вывода 25 000 ₸.");
                return;
              }
              if (amount > balance) {
                if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('error');
                alert("Недостаточно средств на балансе.");
                return;
              }
              if (cardNumber.replace(/\s/g, '').length < 16) {
                if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('error');
                alert("Пожалуйста, введите корректный номер карты (минимум 16 цифр).");
                return;
              }
              
              if (WebApp?.HapticFeedback?.notificationOccurred) WebApp.HapticFeedback.notificationOccurred('success');
              
              const newEntry = {
                id: Date.now(),
                amount: amount,
                card: cardNumber.replace(/\s/g, '').slice(-4),
                date: new Date().toLocaleDateString('ru-RU') + ' ' + new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}),
                status: 'В обработке'
              };
              
              setBalance(prev => prev - amount);
              setWithdrawalHistory(prev => [newEntry, ...prev]);
              setShowWithdrawSuccess(true);
              setWithdrawAmount('');
              setCardNumber('');
            }}
          >
            Вывести средства
          </button>

          {withdrawalHistory.length > 0 && (
            <div style={{marginTop: 32, textAlign: 'left'}}>
               <h3 style={{fontSize: 16, marginBottom: 16, fontWeight: 700}}>История выплат</h3>
               <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                 {withdrawalHistory.map(item => (
                   <div key={item.id} className="slide-in" style={{background: 'var(--nav-bg)', padding: 16, borderRadius: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <div>
                        <div style={{fontWeight: 700, fontSize: 16, color: '#fff'}}>- {item.amount.toLocaleString('ru-RU')} ₸</div>
                        <div style={{color: 'var(--text-secondary)', fontSize: 12, marginTop: 4}}>На карту **** {item.card}</div>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <div style={{color: 'var(--accent)', fontSize: 12, fontWeight: 700, padding: '4px 8px', background: 'rgba(255, 42, 133, 0.1)', borderRadius: 8, display: 'inline-block'}}>{item.status}</div>
                        <div style={{color: 'var(--text-secondary)', fontSize: 11, marginTop: 6}}>{item.date}</div>
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          )}
        </div>
      )}

      {showWithdrawSuccess && (
        <div className="generating-overlay fade-in" style={{zIndex: 300}}>
           <div className="task-view-card slide-in" style={{textAlign: 'center', maxWidth: 320, background: 'var(--panel-bg)'}}>
              <div style={{width: 80, height: 80, borderRadius: '50%', background: 'rgba(0, 230, 118, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px'}}>
                <Check size={40} color="var(--success)" />
              </div>
              <h3 style={{fontSize: 22, fontWeight: 800, marginBottom: 12}}>Запрос принят!</h3>
              <p style={{color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5, marginBottom: 24}}>
                Ваша заявка на вывод средств успешно создана. Деньги поступят на вашу карту в течение 24 часов.
              </p>
              <button className="main-action-btn" onClick={() => setShowWithdrawSuccess(false)}>
                Отлично
              </button>
           </div>
        </div>
      )}

      {showTopUp && (
        <div className="generating-overlay fade-in" style={{zIndex: 200, alignItems: 'flex-start', paddingTop: 60, overflowY: 'auto'}}>
          <div className="task-view-card" style={{width: '90%', maxWidth: '400px', background: 'var(--panel-bg)', marginBottom: 60}}>
            <h2 style={{marginBottom: 16}}>Пополнение баланса</h2>
            <p style={{color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14}}>
              Выберите сумму для пополнения через Telegram Stars.
            </p>
            <div style={{display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24}}>
              {[
                { amount: 5000, stars: 500 },
                { amount: 7500, stars: 700 },
                { amount: 11500, stars: 1000 },
                { amount: 15000, stars: 1250 },
                { amount: 25000, stars: 2000 },
                { amount: 50000, stars: 3500 },
                { amount: 75000, stars: 5000 },
                { amount: 100000, stars: 6000 },
                { amount: 125000, stars: 7000 }
              ].map(plan => (
                <button 
                  key={plan.amount}
                  className="secondary-action-btn" 
                  style={{display: 'flex', justifyContent: 'space-between', padding: '16px 20px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)'}}
                  onClick={() => {
                    fetch(`${API_URL}/create_invoice`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userId, amount: plan.amount })
                    })
                    .then(res => res.json())
                    .then(data => {
                      if (data.invoiceLink) {
                        try {
                           window.location.href = data.invoiceLink;
                           setShowTopUp(false);
                        } catch (e) {
                           alert("Ошибка перенаправления: " + e.message);
                        }
                      } else {
                        alert("Ошибка генерации счета.");
                      }
                    })
                    .catch((err) => {
                      console.error(err);
                      alert("Ошибка: " + err.message);
                    });
                  }}
                >
                  <span style={{fontWeight: 700}}>{plan.amount.toLocaleString()} ₸</span>
                  <span style={{color: '#ffcc00'}}>⭐ {plan.stars}</span>
                </button>
              ))}
            </div>
            <button className="secondary-action-btn" style={{border: 'none', background: 'transparent'}} onClick={() => setShowTopUp(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {activeTab === 'referrals' && (
        <div className="task-view-card fade-in" style={{marginTop: 20}}>
          <h2 style={{fontSize: 24, fontWeight: 800, marginBottom: 16, textAlign: 'center'}}>Партнерская программа</h2>
          <p style={{color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 24}}>
            Приглашайте друзей и получайте <b style={{color: 'var(--accent)'}}>100 ₸</b> за каждого!<br/>Ваш друг тоже получит 100 ₸.
          </p>
          <div style={{background: 'var(--nav-bg)', borderRadius: 16, padding: 16, marginBottom: 24, textAlign: 'center'}}>
            <div style={{fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8}}>Ваша реферальная ссылка:</div>
            <div style={{fontSize: 14, background: 'rgba(0,0,0,0.5)', padding: 12, borderRadius: 8, wordBreak: 'break-all', marginBottom: 16}}>
              https://t.me/AiStock_Kz_bot?start=ref_{userId}
            </div>
            <button className="primary-action-btn" onClick={() => {
              const url = `https://t.me/AiStock_Kz_bot?start=ref_${userId}`;
              const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent("Заходи и зарабатывай на нейросетях со мной! Дают бонус 2500 тг.")}`;
              window.open(tgUrl, '_blank');
            }}>
              Поделиться ссылкой
            </button>
          </div>
          <div style={{background: 'var(--nav-bg)', borderRadius: 16, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
              <div style={{fontSize: 14, color: 'var(--text-secondary)'}}>Доход от друзей</div>
              <div style={{fontSize: 24, fontWeight: 800, color: 'var(--accent)'}}>{profileData ? profileData.referral_balance : 0} ₸</div>
            </div>
            <Users size={32} color="var(--accent)" opacity={0.5} />
          </div>
        </div>
      )}

      {/* BOTTOM NAV BAR */}
      <div className="bottom-nav">
        <div className={`nav-item ${activeTab === 'withdraw' ? 'active' : ''}`} onClick={() => {setActiveTab('withdraw'); setAppState('idle');}}>
          <Wallet size={24} />
          <span>Вывод</span>
        </div>
        <div className={`nav-item ${activeTab === 'referrals' ? 'active' : ''}`} onClick={() => {setActiveTab('referrals'); setAppState('idle');}}>
          <Users size={24} />
          <span>Рефералы</span>
        </div>
        <div className={`nav-item ${activeTab === 'tasks' ? 'active' : ''}`} onClick={() => setActiveTab('tasks')}>
          <div className="nav-icon-hex">
            <Activity size={20} />
          </div>
          <span>Задания</span>
        </div>
        <div className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => {setActiveTab('profile'); setAppState('idle');}}>
          <UserCircle size={24} />
          <span>Профиль</span>
        </div>
      </div>
    </div>
  );
}

export default App;
