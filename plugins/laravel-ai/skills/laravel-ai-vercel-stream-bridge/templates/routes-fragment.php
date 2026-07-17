<?php

// Append these into your routes/web.php (and adjust the project scope if
// your app's parent resource isn't a Project).

use App\Http\Controllers\ChatController;
use Illuminate\Support\Facades\Route;

Route::post('/projects/{project}/chat', [ChatController::class, 'send'])
    ->name('chat.send');

Route::get('/projects/{project}/chat/messages', [ChatController::class, 'messages'])
    ->name('chat.messages');

Route::delete('/projects/{project}/chat', [ChatController::class, 'clear'])
    ->name('chat.clear');
