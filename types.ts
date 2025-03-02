export interface RobloxUser {
    id: number;
    name: string;
    created: string;
}

export interface RobloxBadge {
    id: number;
    name: string;
    description: string;
    created: string;
}

export interface RobloxGroupResponse {
    data: Array<{
        group: {
            id: number;
            name: string;
        };
        role: {
            id: number;
            name: string;
        };
        joined: string;
    }>;
}