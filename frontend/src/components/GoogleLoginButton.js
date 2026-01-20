import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, Alert, Link } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const GoogleLoginButton = () => {
  const { googleLogin } = useAuth();
  const navigate = useNavigate();
  const buttonRef = useRef(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);

  // Получаем Google Client ID из переменных окружения
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // Проверка наличия CLIENT_ID при монтировании компонента
  useEffect(() => {
    if (!googleClientId) {
      console.error('VITE_GOOGLE_CLIENT_ID не определен в переменных окружения');
      setError('Отсутствует Google Client ID. Пожалуйста, проверьте настройки приложения.');
    } else {
      console.log('Google Client ID доступен:', googleClientId.substring(0, 5) + '...');
    }
  }, [googleClientId]);

  // Мемоизируем обработчик ответа с useCallback
  const handleCredentialResponse = useCallback(async (response) => {
    try {
      if (!response || !response.credential) {
        setError('Google вернул пустой ответ');
        return;
      }
      console.log('Получен ответ от Google, отправляем credential на сервер');
      const result = await googleLogin(response.credential);
      console.log('Успешная авторизация через Google', result);
    } catch (error) {
      console.error('Ошибка входа через Google:', error);

      // Расширенный лог ошибки
      let errorMessage = 'Ошибка при входе через Google';
      let details = null;

      if (error.response) {
        // Ответ от сервера с ошибкой
        errorMessage = `Ошибка сервера: ${error.response.status}`;
        details = error.response.data;
        console.error('Ответ сервера:', error.response.data);
      } else if (error.request) {
        // Запрос отправлен, но нет ответа
        errorMessage = 'Сервер не отвечает';
        details = 'Возможно, проблема с сетью или CORS';
      } else {
        // Ошибка в настройке запроса
        errorMessage = `Ошибка запроса: ${error.message}`;
      }

      setError(errorMessage);
      setErrorDetails(details);
    }
  }, [googleLogin, navigate]);

  // Загрузка скрипта Google один раз при монтировании
  useEffect(() => {
    if (!googleClientId) return; // Не загружаем скрипт, если нет client_id

    // Проверяем, не загружен ли уже скрипт
    if (document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
      setIsScriptLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.log('Google script успешно загружен');
      setIsScriptLoaded(true);
    };
    script.onerror = (e) => {
      console.error('Не удалось загрузить Google API', e);
      setError('Не удалось загрузить Google API');
    };
    document.body.appendChild(script);

    return () => {
      // Не удаляем скрипт при размонтировании, так как он может использоваться глобально
    };
  }, [googleClientId]);

  // Рендерим кнопку Google когда скрипт загружен и DOM элемент доступен
  useEffect(() => {
    if (isScriptLoaded && buttonRef.current && window.google && googleClientId) {
      try {
        console.log('Инициализируем Google Sign-In с ID:', googleClientId.substring(0, 5) + '...');

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true
        });

        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: buttonRef.current.offsetWidth
        });

        console.log('Кнопка Google успешно инициализирована');
      } catch (error) {
        console.error('Ошибка инициализации Google Sign-In:', error);
        setError(`Ошибка инициализации Google Sign-In: ${error.message}`);
      }
    }
  }, [isScriptLoaded, googleClientId, handleCredentialResponse]);

  // Если есть ошибка, показываем сообщение
  if (error) {
    return (
      <Box sx={{ width: '100%', my: 2 }}>
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>

        {errorDetails && (
          <Typography variant="body2" sx={{ mt: 1, mb: 2, pl: 2, borderLeft: '4px solid #f44336' }}>
            {typeof errorDetails === 'object'
              ? JSON.stringify(errorDetails, null, 2)
              : errorDetails}
          </Typography>
        )}

        <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
          Client ID: {googleClientId ? `${googleClientId.substring(0, 5)}...` : 'не определен'}
        </Typography>

        <Typography variant="body2" sx={{ mt: 2 }}>
          Возможные причины:
          <ul>
            <li>Проблемы с настройками CORS на сервере</li>
            <li>Неправильный URI в настройках Google OAuth</li>
            <li>Сервер недоступен или вернул ошибку</li>
          </ul>
        </Typography>

        <Link href="/login" variant="body2" sx={{ mt: 1, display: 'block' }}>
          Попробовать войти с логином и паролем
        </Link>
      </Box>
    );
  }

  return (
    <Box
      ref={buttonRef}
      sx={{
        width: '100%',
        height: '40px',
        my: 2,
        display: 'flex',
        justifyContent: 'center'
      }}
    />
  );
};

export default GoogleLoginButton;
