import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    login(req: any, dto: LoginDto): Promise<{
        access_token: string;
        user: {
            id: any;
            email: any;
            name: any;
            roles: any;
            permissions: any;
        };
    }>;
    register(dto: RegisterDto): Promise<{
        id: string;
        email: string;
        name: string;
    }>;
    me(user: any): any;
}
