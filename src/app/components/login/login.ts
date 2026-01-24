import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './login.html',
})
export class Login {
  authService = inject(AuthService);
  
  email = '';
  password = '';
  errorMessage = '';

  async onLogin() {
    try {
      await this.authService.login(this.email, this.password);
    } catch (err: any) {
      this.errorMessage = err;
    }
  }
}